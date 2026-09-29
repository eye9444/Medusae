import {spawn} from 'node:child_process';
import {mkdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {settings} from '../core/config.mjs';
import {findSnapshot,getSnapshot,putSnapshot} from '../core/store.mjs';

export function canonicalRepository(input){
  let url;try{url=new URL(input);}catch{throw new Error('Enter a public GitHub URL, for example https://github.com/expressjs/cors.');}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||url.search||url.hash||!/^[\w.-]+\/[\w.-]+\/?$/.test(url.pathname.slice(1))) throw new Error('Use a public https://github.com/owner/repository URL.');
  const pathname=url.pathname.replace(/\.git\/?$/,'').replace(/\/$/,'');
  return `https://github.com${pathname}`;
}
function child(command,args,{cwd,timeout= settings.acquireTimeoutMs,maxBytes=settings.maxRepoBytes,signal}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) return reject(new DOMException('Cancelled','AbortError'));
    const proc=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],shell:false,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ALLOW_PROTOCOL:'https'}});
    let out=Buffer.alloc(0),err=Buffer.alloc(0),finished=false;
    const append=(current,chunk)=>Buffer.concat([current,Buffer.from(chunk)]).subarray(0,maxBytes+1);
    const timer=setTimeout(()=>{if(!finished){proc.kill('SIGTERM');setTimeout(()=>proc.kill('SIGKILL'),1000).unref();}},timeout);
    const abort=()=>{if(!finished)proc.kill('SIGTERM');};
    signal?.addEventListener('abort',abort,{once:true});
    proc.stdout.on('data',chunk=>{out=append(out,chunk);if(out.length>maxBytes)proc.kill('SIGTERM');});
    proc.stderr.on('data',chunk=>{err=append(err,chunk);if(err.length>maxBytes)proc.kill('SIGTERM');});
    proc.on('error',error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error);});
    proc.on('close',code=>{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(new DOMException('Cancelled','AbortError'));if(code===0&&out.length<=maxBytes&&err.length<=maxBytes)resolve({stdout:out,stderr:err});else reject(new Error(`Git ${args[0]} failed (${code}). ${err.toString('utf8').replace(/[\x00-\x1f]/g,' ').slice(0,500)}`));});
  });
}
function safeDir(repository){return createHash('sha256').update(repository).digest('hex').slice(0,32);}
export async function acquireSnapshot(input,{refresh=false,onEvent=()=>{},signal}={}){
  const repository=canonicalRepository(input);const root=path.join(settings.dataDirectory,'repos');await mkdir(root,{recursive:true,mode:0o700});
  const gitDir=path.join(root,`${safeDir(repository)}.git`);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  let exists=false;try{exists=(await stat(gitDir)).isDirectory();}catch{}
  try{
    if(!exists){onEvent({type:'phase',message:'Fetching repository…'});await child('git',['clone','--bare','--depth=1','--no-tags','--config','core.hooksPath=/dev/null',repository,gitDir],{signal});}
    else if(refresh){onEvent({type:'phase',message:'Refreshing repository…'});await child('git',[`--git-dir=${gitDir}`,'fetch','--depth=1','--no-tags','origin','HEAD:refs/heads/medusae-refresh'],{signal});}
    const revision=refresh?'refs/heads/medusae-refresh':'HEAD';
    const commit=(await child('git',[`--git-dir=${gitDir}`,'rev-parse',revision],{maxBytes:256,signal})).stdout.toString('utf8').trim();
    const existing=findSnapshot(repository,commit);if(existing)return existing;
    const snapshot={id:randomUUID(),repository,commitSha:commit,gitDir,status:'acquired',manifest:{repository,commitSha:commit,indexedFiles:0,indexedBytes:0,excluded:[],partial:false},createdAt:new Date().toISOString()};
    putSnapshot(snapshot);return getSnapshot(snapshot.id);
  }catch(error){if(!exists)await rm(gitDir,{recursive:true,force:true}).catch(()=>{});throw error;}
}
export async function gitText(snapshot,relativePath,{maxBytes=settings.maxFileBytes}={}){
  if(!snapshot||!relativePath||relativePath.includes('..')||relativePath.startsWith('/'))throw new Error('Invalid indexed source path.');
  const {stdout}=await child('git',[`--git-dir=${snapshot.gitDir}`,'show',`${snapshot.commitSha}:${relativePath}`],{maxBytes,timeout:30000});
  return stdout.toString('utf8');
}
export async function treeEntries(snapshot){
  const {stdout}=await child('git',[`--git-dir=${snapshot.gitDir}`,'ls-tree','-r','-l','-z',snapshot.commitSha],{maxBytes:settings.maxRepoBytes,timeout:30000});
  return stdout.toString('utf8').split('\0').filter(Boolean).map(entry=>{
    const match=entry.match(/^(\d+) (\w+) ([0-9a-f]+)\s+(\d+|-)\t(.+)$/);return match&&{mode:match[1],type:match[2],sha:match[3],size:match[4]==='-'?0:Number(match[4]),path:match[5]};
  }).filter(Boolean);
}
