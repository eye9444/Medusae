import {randomUUID} from 'node:crypto';
import {settings} from '../core/config.mjs';
import {getSnapshot,insertFiles,listFiles} from '../core/store.mjs';
import {gitText,treeEntries} from './snapshot.mjs';

const blockedSegments=new Set(['node_modules','vendor','coverage','.git','dist','build','.next','.cache','__pycache__']);
const blockedNames=[/^\.env/i,/credential/i,/secret/i,/oauth.*client/i,/id_rsa/i,/\.pem$/i,/\.key$/i,/package-lock\.json$/i,/pnpm-lock\.yaml$/i,/yarn\.lock$/i,/\.min\.(js|css)$/i];
const sourceExtensions=new Map([['.js','JavaScript'],['.mjs','JavaScript'],['.cjs','JavaScript'],['.ts','TypeScript'],['.tsx','TypeScript'],['.jsx','JavaScript'],['.py','Python'],['.java','Java'],['.go','Go'],['.rs','Rust'],['.rb','Ruby'],['.php','PHP'],['.cs','C#'],['.c','C'],['.h','C/C++'],['.cpp','C++'],['.json','JSON'],['.yaml','YAML'],['.yml','YAML'],['.toml','TOML'],['.md','Markdown'],['.html','HTML'],['.css','CSS'],['.sql','SQL'],['.sh','Shell']]);
const usefulNames=new Set(['readme','package.json','tsconfig.json','vite.config.js','next.config.mjs','dockerfile','makefile']);
function ext(path){const dot=path.lastIndexOf('.');return dot<0?'':path.slice(dot).toLowerCase();}
function allowed(entry){const segments=entry.path.split('/');const base=segments.at(-1);if(entry.type!=='blob'||entry.mode!=='100644'||entry.size<=0||entry.size>settings.maxFileBytes)return false;if(segments.some(segment=>blockedSegments.has(segment.toLowerCase()))||blockedNames.some(pattern=>pattern.test(base)))return false;return sourceExtensions.has(ext(base))||usefulNames.has(base.toLowerCase());}
function kind(file){if(/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\./i.test(file.path))return 'test';if(/readme|package\.json|config|dockerfile|makefile/i.test(file.path))return 'manifest';return 'implementation';}
function symbolFor(line){const match=line.match(/(?:function|class|interface|const|let|var|def|func|public|private)\s+([A-Za-z_$][\w$]*)/);return match?.[1]||null;}
function chunksFor(file,text){const lines=text.split('\n'),chunks=[];const size=100,overlap=12;for(let start=0;start<lines.length;start+=size-overlap){const end=Math.min(lines.length,start+size);const contents=lines.slice(start,end).join('\n');chunks.push({id:randomUUID(),fileId:file.id,startLine:start+1,endLine:end,text:contents,symbol:symbolFor(lines[start]||'')});if(end===lines.length)break;}return chunks;}
export async function indexSnapshot(snapshotId,{onEvent=()=>{},signal}={}){
  const existing=listFiles(snapshotId);if(existing.length)return {snapshot:getSnapshot(snapshotId),files:existing,indexed:false};
  const snapshot=getSnapshot(snapshotId);if(!snapshot)throw new Error('Snapshot not found.');onEvent({type:'phase',message:'Indexing safe source files…'});
  const entries=await treeEntries(snapshot);const files=[],chunks=[],excluded=[];let total=0;
  for(const entry of entries){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(files.length>=settings.maxFiles){excluded.push({path:entry.path,reason:'file limit'});continue;}
    if(!allowed(entry)){excluded.push({path:entry.path,reason:'policy or size'});continue;}
    if(total+entry.size>settings.maxIndexBytes){excluded.push({path:entry.path,reason:'index byte limit'});continue;}
    let text;try{text=await gitText(snapshot,entry.path);}catch{excluded.push({path:entry.path,reason:'unreadable or non-text'});continue;}
    if(text.includes('\0')){excluded.push({path:entry.path,reason:'binary'});continue;}
    const file={id:randomUUID(),path:entry.path,byteCount:Buffer.byteLength(text),lineCount:text.split('\n').length,language:sourceExtensions.get(ext(entry.path))||'Text',kind:kind({path:entry.path}),indexed:true};
    files.push(file);chunks.push(...chunksFor(file,text));total+=file.byteCount;
  }
  insertFiles(snapshotId,files,chunks);
  const manifest={...snapshot.manifest,indexedFiles:files.length,indexedBytes:total,candidateFiles:entries.length,excluded:excluded.slice(0,100),excludedCount:excluded.length,partial:excluded.some(item=>/limit/.test(item.reason))};
  const db=(await import('../core/store.mjs')).getStore();db.prepare('UPDATE snapshots SET status=?,manifest_json=? WHERE id=?').run('indexed',JSON.stringify(manifest),snapshotId);
  return {snapshot:getSnapshot(snapshotId),files,indexed:true};
}
