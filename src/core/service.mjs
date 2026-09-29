import {rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {settings} from './config.mjs';
import {randomUUID} from 'node:crypto';
import {initialiseStore,getStore,createSession,getSession,setSessionSnapshot,appendTurn,getSnapshot,listSessions,getFile,getReport} from './store.mjs';
import {acquireSnapshot,canonicalRepository,gitText} from '../repo/snapshot.mjs';
import {indexSnapshot} from '../repo/index.mjs';
import {analyse} from './analyse.mjs';
import {research} from './research.mjs';
import {cappedString} from './contracts.mjs';

export async function prepareRepository({repository,refresh=false,onEvent=()=>{},signal}={}){await initialiseStore();const snapshot=await acquireSnapshot(repository,{refresh,onEvent,signal});const indexed=await indexSnapshot(snapshot.id,{onEvent,signal});const report=await analyse({snapshot:indexed.snapshot,onEvent,signal});return {snapshot:indexed.snapshot,report:report.report,indexedFiles:indexed.files.length,indexed:indexed.indexed};}
export async function openSession({repository,refresh=false,onEvent=()=>{},signal}={}){const prepared=await prepareRepository({repository,refresh,onEvent,signal});const session=createSession(canonicalRepository(repository),prepared.snapshot.id);return {session:getSession(session.id),...prepared};}
export async function refreshSession(sessionId,{onEvent=()=>{},signal}={}){await initialiseStore();const session=getSession(sessionId);if(!session)throw new Error('Session not found.');const prepared=await prepareRepository({repository:session.repository,refresh:true,onEvent,signal});setSessionSnapshot(session.id,prepared.snapshot.id);return {session:getSession(session.id),...prepared};}
export async function rebuildMap({sessionId=null,snapshotId=null,onEvent=()=>{},signal,routes=null}={}){await initialiseStore();const session=sessionId?getSession(sessionId):null,snapshot=snapshotId?getSnapshot(snapshotId):session?.snapshotId?getSnapshot(session.snapshotId):null;if(sessionId&&!session)throw new Error('Session not found.');if(session&&snapshotId&&session.snapshotId!==snapshotId)throw new Error('The requested snapshot does not belong to this chat.');if(!snapshot)throw new Error('Open a repository session before rebuilding its map.');const result=await analyse({snapshot,force:true,onEvent,signal,routes});return {session:sessionId?getSession(sessionId):null,snapshot,report:result.report,metadata:result};}
function asksAboutMedusaeMap(question){return /\b(medusae|your|you|this tool)\b/i.test(question)&&/\b(visual map|visual graph|architecture map|repository map|report)\b/i.test(question)||/\b(have|did)\s+you\s+(create|make|generate|build)\b/i.test(question)&&/\b(map|graph|report)\b/i.test(question);}
function isGreeting(question){return /^(?:hey+|heya+|hello+|hi+|yo+|good\s+(?:morning|afternoon|evening))(?:[!,.\s]*)$/i.test(question);}
function greetingAnswer(snapshot){
  const repository=snapshot.repository.replace('https://github.com/','');
  return {answer:{status:'answered',summary:`Hey, I’m Medusae. I have ${repository} pinned at ${snapshot.commitSha.slice(0,12)} and I’m ready to follow its threads. Ask me about a file, function, feature, or the visual map.`,claims:[],limitations:[],followUps:['How is a specific feature implemented?','What does a named function do?','Have you created the visual map?'],citations:[]},metadata:{cacheHit:true,model:'local greeting',provider:'local',elapsedMs:0,usage:null,retrieval:{chunks:0,bytes:0}}};
}
function mapStatusAnswer(snapshot){
  const report=getReport(snapshot.id)?.report;if(!report)return null;
  return {answer:{status:'answered',summary:`Yes. Medusae created a local visual map for ${snapshot.repository.replace('https://github.com/','')} at ${snapshot.commitSha.slice(0,12)}. It contains ${report.components.length} source-backed component cards and ${report.edges.length} relationship links.`,claims:[],limitations:[...report.limitations,'The current map is generated from the indexed snapshot. Relationship links marked inferred are not claimed as proven runtime flow.'],followUps:['Open Visual Map from the main menu to explore cards and source.','Ask about a named file or function to inspect the implementation.'],citations:[]},metadata:{cacheHit:true,model:'local report',provider:'local',elapsedMs:0,usage:null,retrieval:{chunks:0,bytes:0},reportSnapshotId:snapshot.id}};
}
export async function askRepository({repository,question,sessionId=null,snapshotId=null,hints=[],onEvent=()=>{},signal,testProvider=null,routes=null}={}){
  await initialiseStore();let session=sessionId?getSession(sessionId):null;let snapshot=snapshotId?getSnapshot(snapshotId):session?.snapshotId?getSnapshot(session.snapshotId):null;
  if(!snapshot){const prepared=await prepareRepository({repository,onEvent,signal});snapshot=prepared.snapshot;if(session)setSessionSnapshot(session.id,snapshot.id);}
  if(!session&&sessionId)throw new Error('Session not found.');const requestId=randomUUID();const clean=cappedString(question,4000);if(session)session=appendTurn(session.id,'user',clean,{requestId,expectedRevision:session.revision});
  let result;if(isGreeting(clean)){onEvent({type:'phase',requestId,message:'Medusae is ready.'});result=greetingAnswer(snapshot);}else if(asksAboutMedusaeMap(clean)){onEvent({type:'phase',requestId,message:'Checking the local visual map…'});result=mapStatusAnswer(snapshot)||await research({snapshot,question:clean,sessionId:session?.id,hints,signal,onEvent:event=>onEvent({...event,requestId}),testProvider,routes});}else result=await research({snapshot,question:clean,sessionId:session?.id,hints,signal,onEvent:event=>onEvent({...event,requestId}),testProvider,routes});
  if(session)session=appendTurn(session.id,'assistant',result.answer.summary,{answer:{...result.answer,model:result.metadata.model,provider:result.metadata.provider},requestId,expectedRevision:session.revision});
  return {requestId,snapshot,result,session};
}
export async function readSource({snapshotId,fileId,startLine=1,endLine=null}={}){await initialiseStore();const snapshot=getSnapshot(snapshotId);const file=getFile(snapshotId,fileId);if(!snapshot||!file)throw new Error('This source file is not part of the selected repository snapshot.');const lines=(await gitText(snapshot,file.path)).split('\n');const start=Math.max(1,Number(startLine)||1),end=Math.min(lines.length,Number(endLine)||lines.length);return {snapshotId,fileId,path:file.path,commitSha:snapshot.commitSha,startLine:start,endLine:end,lineCount:lines.length,lines:lines.slice(start-1,end)};}
export async function doctor(){await initialiseStore();const {spawnSync}=await import('node:child_process');const {access,constants}=await import('node:fs/promises');const {settings,publicConfig}=await import('./config.mjs');const git=spawnSync('git',['--version'],{encoding:'utf8'});let writable=true;try{await access(settings.dataDirectory,constants.W_OK);}catch{writable=false;}return {node:process.version,git:git.status===0?git.stdout.trim():null,dataDirectory:settings.dataDirectory,dataDirectoryWritable:writable,schemaVersion:1,sessions:listSessions().length,provider:publicConfig()};}
export {getSession,listSessions,initialiseStore};

export async function deleteChat(sessionId){
 await initialiseStore();const db=getStore();let removedRepository=false;
 db.exec('BEGIN IMMEDIATE');
 try{
  const session=getSession(sessionId);if(!session)throw new Error('Chat not found.');
  const shared=db.prepare('SELECT count(*) AS n FROM sessions WHERE repository=? AND id<>?').get(session.repository,sessionId).n;
  if(!shared){
   const root=path.resolve(settings.dataDirectory,'repos');
   const dirs=db.prepare('SELECT DISTINCT git_dir FROM snapshots WHERE repository=?').all(session.repository);
   for(const {git_dir} of dirs){const resolved=path.resolve(git_dir);if(path.dirname(resolved)!==root||! /^[a-f0-9]{32}\.git$/.test(path.basename(resolved)))throw new Error('Refusing cleanup outside the repository cache.');}
   for(const {git_dir} of dirs)rmSync(git_dir,{recursive:true,force:true});
   db.prepare('DELETE FROM snapshots WHERE repository=?').run(session.repository);removedRepository=true;
  }else{
   // Answer caches can contain conversation context; remove them for this repository.
   db.prepare('DELETE FROM research_cache WHERE snapshot_id IN (SELECT id FROM snapshots WHERE repository=?)').run(session.repository);
  }
  for(const name of ['sessions.json.migrated','sessions.v1.backup.json']){const filename=path.join(settings.dataDirectory,name);if(existsSync(filename)){const data=JSON.parse(readFileSync(filename,'utf8'));if(Array.isArray(data.sessions)){data.sessions=data.sessions.filter(s=>s.id!==sessionId);writeFileSync(filename,JSON.stringify(data),{mode:0o600});}}}
  db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 db.exec('PRAGMA wal_checkpoint(PASSIVE)');
 return {removedRepository};
}
