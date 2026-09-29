import {getChunks,listFiles} from '../core/store.mjs';
import {settings} from '../core/config.mjs';

const tokens=value=>Array.from(new Set(String(value).toLowerCase().match(/[a-z_$][\w$-]{1,}/g)||[]));
export function retrieve(snapshotId,question,{hints=[]}={}){
  const terms=tokens(question),named=tokens(question).filter(token=>/[A-Z_]/.test(question.match(new RegExp(token,'i'))?.[0]||'')||token.length>8);const files=new Map(listFiles(snapshotId).map(file=>[file.id,file]));
  const candidates=getChunks(snapshotId).map(chunk=>{const hay=`${chunk.path}\n${chunk.symbol||''}\n${chunk.text}`.toLowerCase();let score=0;for(const term of terms){if(chunk.path.toLowerCase().includes(term))score+=8;const hits=hay.split(term).length-1;score+=Math.min(5,hits)*2;}for(const term of named){if(chunk.symbol?.toLowerCase()===term)score+=40;else if(chunk.text.toLowerCase().includes(term))score+=15;}if(files.get(chunk.fileId)?.kind==='implementation')score+=5;if(hints.includes(chunk.fileId))score+=25;return {...chunk,score};}).filter(chunk=>chunk.score>0).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  const result=[],used=new Set();let bytes=0;const implementation=candidates.filter(chunk=>files.get(chunk.fileId)?.kind==='implementation');
  for(const pool of [implementation,candidates])for(const chunk of pool){if(result.length>=settings.retrievalChunks||bytes+Buffer.byteLength(chunk.text)>settings.retrievalBytes)break;if(used.has(chunk.id))continue;result.push(chunk);used.add(chunk.id);bytes+=Buffer.byteLength(chunk.text);}
  return {chunks:result,terms,bytes};
}
