import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
const testDirectory=mkdtempSync(path.join(tmpdir(),'medusae-options-'));process.env.MEDUSAE_DATA_DIR=testDirectory;
const {mapRoutes}=await import('../src/core/config.mjs');test.after(()=>rmSync(testDirectory,{recursive:true,force:true}));import {reportNodeSchema} from '../src/core/contracts.mjs';
test('map components accept more than twelve indexed files',()=>{
 const node={id:'core',name:'Core',kind:'MODULE',icon:'code',accent:'mint',summary:'Core files',role:'Application core',tags:[],fileIds:Array.from({length:20},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`),citationIds:['00000000-0000-4000-8000-000000000000']};assert.equal(reportNodeSchema.parse(node).fileIds.length,20);
});
test('Ollama mapping is explicit and cloud requires a key',()=>{
 const keys=['MEDUSAE_MAP_PROVIDER','MEDUSAE_MAP_MODEL','OLLAMA_API_KEY'],saved=keys.map(k=>process.env[k]);
 try{process.env.MEDUSAE_MAP_PROVIDER='ollama';process.env.MEDUSAE_MAP_MODEL='fixture';assert.equal(mapRoutes()[0].baseUrl,'http://127.0.0.1:11434/v1');process.env.MEDUSAE_MAP_PROVIDER='ollama-cloud';delete process.env.OLLAMA_API_KEY;assert.equal(mapRoutes().length,0);process.env.OLLAMA_API_KEY='test-only';assert.equal(mapRoutes()[0].baseUrl,'https://ollama.com/v1');}finally{keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
});

test('map format accepts large graphs, mixed-case IDs and a single limitation',async()=>{
 const {modelReportSchema}=await import('../src/core/contracts.mjs');
 const components=Array.from({length:101},(_,i)=>({id:`Module_${i}`,name:'Module',kind:'MODULE',icon:'code',accent:'mint',summary:'Module',role:'Role',tags:[],fileIds:['00000000-0000-4000-8000-000000000000']}));
 const parsed=modelReportSchema.parse({summary:'Map',profile:'signal',components,edges:[],workflows:[],limitations:'Partial index'});
 assert.equal(parsed.components.length,101);assert.equal(parsed.components[0].id,'Module_0');assert.deepEqual(parsed.limitations,['Partial index']);
 assert.deepEqual(modelReportSchema.parse({...parsed,limitations:undefined}).limitations,[]);
});

test('answer format normalizes singleton lists without accepting unknown evidence',async()=>{
 const {resolveEvidenceReferences}=await import('../src/core/research.mjs');
 const answer={status:'answered',summary:'A result',claims:{text:'A claim',sources:'S1'},limitations:'Limited evidence'};
 const evidence=[{fileId:'00000000-0000-4000-8000-000000000000',path:'a.js',startLine:1,endLine:2}];
 assert.equal(resolveEvidenceReferences(answer,evidence).claims.length,1);
 assert.throws(()=>resolveEvidenceReferences({...answer,claims:{text:'A claim',sources:'S99'}},evidence),/Unknown evidence/);
});

test('default picker lists unique routes, installed local/cloud models and custom',async()=>{const {defaultModelOptions}=await import('../src/tui.mjs');const options=defaultModelOptions([{provider:'gemini',model:'fixture'}],[{name:'qwen3:4b'},{name:'gpt-oss:120b-cloud'}],{provider:'gemini',model:'fixture'});assert.deepEqual(options.map(o=>o.value),['auto','gemini fixture','ollama qwen3:4b','ollama gpt-oss:120b-cloud','custom']);});
