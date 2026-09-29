import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {settings} from './config.mjs';

let database;
function now(){return new Date().toISOString();}
function json(value){return JSON.stringify(value??null);}
function parse(value,fallback=null){try{return JSON.parse(value);}catch{return fallback;}}
export function hash(value){return createHash('sha256').update(value).digest('hex');}

export async function migrateLegacySessions(){
  const legacy=path.join(settings.dataDirectory,'sessions.json');
  const marker=path.join(settings.dataDirectory,'sessions-v1-migrated');
  try { await readFile(marker); return; } catch {}
  let raw; try{raw=await readFile(legacy,'utf8');}catch(error){if(error.code==='ENOENT'){await writeFile(marker,now(),{mode:0o600});return;}throw error;}
  const data=parse(raw); if(!data||data.version!==1||!Array.isArray(data.sessions)) return;
  const backup=path.join(settings.dataDirectory,'sessions.v1.backup.json');
  try{await readFile(backup);}catch{await writeFile(backup,raw,{mode:0o600});}
  const db=getStore();
  for(const session of data.sessions){
    if(!session?.id||!session?.repository)continue;
    db.prepare('INSERT OR IGNORE INTO sessions(id, repository, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 0)').run(session.id,session.repository,session.createdAt||now(),session.updatedAt||now());
    for(const message of session.messages||[]){
      if(message?.role==='user'&&typeof message.content==='string') db.prepare('INSERT OR IGNORE INTO turns(id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(),session.id,'user',message.content,message.createdAt||session.updatedAt||now());
    }
  }
  await rename(legacy,`${legacy}.migrated`).catch(()=>{});
  await writeFile(marker,now(),{mode:0o600});
}

export async function initialiseStore(){await mkdir(settings.dataDirectory,{recursive:true,mode:0o700});getStore();await migrateLegacySessions();return getStore();}
export function getStore(){
  if(database)return database;
  const filename=path.join(settings.dataDirectory,settings.databaseName);
  database=new DatabaseSync(filename,{timeout:5000});
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  database.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, repository TEXT NOT NULL, snapshot_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, answer_json TEXT, created_at TEXT NOT NULL, request_id TEXT);
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, repository TEXT NOT NULL, commit_sha TEXT NOT NULL, git_dir TEXT NOT NULL, status TEXT NOT NULL, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(repository,commit_sha));
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, path TEXT NOT NULL, byte_count INTEGER NOT NULL, line_count INTEGER NOT NULL, language TEXT, kind TEXT, indexed INTEGER NOT NULL, UNIQUE(snapshot_id,path));
CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, symbol TEXT, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id) ON DELETE CASCADE, report_json TEXT NOT NULL, created_at TEXT NOT NULL, config_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_cache (cache_key TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, answer_json TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leases (lease_key TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS turns_session_created ON turns(session_id,created_at);
CREATE INDEX IF NOT EXISTS chunks_snapshot_file ON chunks(snapshot_id,file_id);`);
  return database;
}
export function acquireLease(key,ttlMs=120000){const db=getStore(),holder=randomUUID(),expires=Date.now()+ttlMs;db.prepare('DELETE FROM leases WHERE expires_at < ?').run(Date.now());try{db.prepare('INSERT INTO leases(lease_key,holder,expires_at) VALUES (?,?,?)').run(key,holder,expires);return holder;}catch{return null;}}
export function releaseLease(key,holder){getStore().prepare('DELETE FROM leases WHERE lease_key=? AND holder=?').run(key,holder);}
export function createSession(repository,snapshotId=null){const session={id:randomUUID(),repository,snapshotId,createdAt:now(),updatedAt:now(),revision:0};getStore().prepare('INSERT INTO sessions(id,repository,snapshot_id,created_at,updated_at,revision) VALUES(?,?,?,?,?,0)').run(session.id,repository,snapshotId,session.createdAt,session.updatedAt);return session;}
export function listSessions(){return getStore().prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all().map(row=>({...row,snapshotId:row.snapshot_id,createdAt:row.created_at,updatedAt:row.updated_at}));}
export function getSession(id){const row=getStore().prepare('SELECT * FROM sessions WHERE id=?').get(id);if(!row)return null;const turns=getStore().prepare('SELECT * FROM turns WHERE session_id=? ORDER BY created_at,id').all(id).map(turn=>({id:turn.id,role:turn.role,content:turn.content,answer:parse(turn.answer_json),createdAt:turn.created_at,requestId:turn.request_id}));return {id:row.id,repository:row.repository,snapshotId:row.snapshot_id,createdAt:row.created_at,updatedAt:row.updated_at,revision:row.revision,messages:turns};}
export function appendTurn(sessionId,role,content,{answer=null,requestId=null,expectedRevision=null}={}){const db=getStore(),session=db.prepare('SELECT revision FROM sessions WHERE id=?').get(sessionId);if(!session)throw new Error('Session not found.');if(expectedRevision!==null&&session.revision!==expectedRevision)throw new Error('This session changed in another process. Reload it before sending another message.');const timestamp=now();db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO turns(id,session_id,role,content,answer_json,created_at,request_id) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),sessionId,role,content,answer?json(answer):null,timestamp,requestId);db.prepare('UPDATE sessions SET updated_at=?,revision=revision+1 WHERE id=?').run(timestamp,sessionId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return getSession(sessionId);}
export function setSessionSnapshot(sessionId,snapshotId){getStore().prepare('UPDATE sessions SET snapshot_id=?,updated_at=?,revision=revision+1 WHERE id=?').run(snapshotId,now(),sessionId);}
export function putSnapshot(snapshot){const db=getStore();const existing=db.prepare('SELECT id FROM snapshots WHERE repository=? AND commit_sha=?').get(snapshot.repository,snapshot.commitSha);if(existing)return existing.id;db.prepare('INSERT INTO snapshots(id,repository,commit_sha,git_dir,status,manifest_json,created_at) VALUES(?,?,?,?,?,?,?)').run(snapshot.id,snapshot.repository,snapshot.commitSha,snapshot.gitDir,snapshot.status,json(snapshot.manifest),snapshot.createdAt||now());return snapshot.id;}
export function getSnapshot(id){const row=getStore().prepare('SELECT * FROM snapshots WHERE id=?').get(id);return row&&{id:row.id,repository:row.repository,commitSha:row.commit_sha,gitDir:row.git_dir,status:row.status,manifest:parse(row.manifest_json,{}),createdAt:row.created_at};}
export function findSnapshot(repository,commitSha){const row=getStore().prepare('SELECT id FROM snapshots WHERE repository=? AND commit_sha=?').get(repository,commitSha);return row?getSnapshot(row.id):null;}
export function insertFiles(snapshotId,files,chunks){const db=getStore();db.exec('BEGIN IMMEDIATE');try{const fileInsert=db.prepare('INSERT INTO files(id,snapshot_id,path,byte_count,line_count,language,kind,indexed) VALUES(?,?,?,?,?,?,?,?)');const chunkInsert=db.prepare('INSERT INTO chunks(id,snapshot_id,file_id,start_line,end_line,symbol,text) VALUES(?,?,?,?,?,?,?)');for(const file of files)fileInsert.run(file.id,snapshotId,file.path,file.byteCount,file.lineCount,file.language,file.kind,file.indexed?1:0);for(const chunk of chunks)chunkInsert.run(chunk.id,snapshotId,chunk.fileId,chunk.startLine,chunk.endLine,chunk.symbol||null,chunk.text);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
export function listFiles(snapshotId){return getStore().prepare('SELECT * FROM files WHERE snapshot_id=? AND indexed=1 ORDER BY path').all(snapshotId).map(row=>({id:row.id,path:row.path,byteCount:row.byte_count,lineCount:row.line_count,language:row.language,kind:row.kind,indexed:Boolean(row.indexed)}));}
export function getFile(snapshotId,fileId){const row=getStore().prepare('SELECT * FROM files WHERE snapshot_id=? AND id=? AND indexed=1').get(snapshotId,fileId);return row&&{id:row.id,path:row.path,byteCount:row.byte_count,lineCount:row.line_count,language:row.language,kind:row.kind,indexed:Boolean(row.indexed)};}
export function getChunks(snapshotId){return getStore().prepare('SELECT chunks.*,files.path FROM chunks JOIN files ON files.id=chunks.file_id WHERE chunks.snapshot_id=?').all(snapshotId).map(row=>({id:row.id,fileId:row.file_id,path:row.path,startLine:row.start_line,endLine:row.end_line,symbol:row.symbol,text:row.text}));}
export function getCached(key){const row=getStore().prepare('SELECT * FROM research_cache WHERE cache_key=?').get(key);return row&&{answer:parse(row.answer_json),metadata:parse(row.metadata_json),createdAt:row.created_at};}
export function putCached(key,snapshotId,answer,metadata){getStore().prepare('INSERT OR REPLACE INTO research_cache(cache_key,snapshot_id,answer_json,metadata_json,created_at) VALUES(?,?,?,?,?)').run(key,snapshotId,json(answer),json(metadata),now());}
export function getReport(snapshotId){const row=getStore().prepare('SELECT * FROM reports WHERE snapshot_id=?').get(snapshotId);return row&&{report:parse(row.report_json),createdAt:row.created_at,configHash:row.config_hash};}
export function putReport(snapshotId,report,configHash){getStore().prepare('INSERT OR REPLACE INTO reports(snapshot_id,report_json,created_at,config_hash) VALUES(?,?,?,?)').run(snapshotId,json(report),now(),configHash);}
