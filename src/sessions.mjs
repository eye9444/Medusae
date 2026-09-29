import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const dataDirectory = process.env.MEDUSAE_DATA_DIR || fileURLToPath(new URL('../.medusae/', import.meta.url));
export function validateRepository(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a GitHub URL, for example https://github.com/expressjs/cors'); }
  if(url.protocol!=='https:' || url.hostname!=='github.com' || url.username || url.password || url.port || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) throw new Error('Use a public https://github.com/owner/repository URL.');
  return `https://github.com${url.pathname.replace(/\/$/,'').replace(/\.git$/,'')}`;
}
export async function loadSessions(directory = dataDirectory) {
  let text;
  try { text = await readFile(path.join(directory,'sessions.json'),'utf8'); }
  catch(error) { if(error.code==='ENOENT')return []; throw error; }
  let parsed;
  try { parsed=JSON.parse(text); } catch { throw new Error('Saved sessions are unreadable; the original file has been preserved.'); }
  if(parsed.version!==1 || !Array.isArray(parsed.sessions) || !parsed.sessions.every(s=>typeof s.id==='string' && typeof s.repository==='string' && typeof s.updatedAt==='string' && Array.isArray(s.messages) && s.messages.every(m=>m.role==='user'&&typeof m.content==='string'))) throw new Error('Unsupported session data; the original file has been preserved.');
  return parsed.sessions;
}
export async function saveSessions(sessions, directory = dataDirectory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=path.join(directory,`sessions.${randomUUID()}.tmp`);
  await writeFile(temporary,JSON.stringify({version:1,sessions},null,2),{mode:0o600});
  await rename(temporary,path.join(directory,'sessions.json'));
}
export function createSession(repository) {
  return {id:randomUUID(),repository:validateRepository(repository),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};
}
