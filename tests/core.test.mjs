import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const directory=await mkdtemp(path.join(tmpdir(),'medusae-core-'));
process.env.MEDUSAE_DATA_DIR=directory;
const {initialiseStore,putSnapshot,getSnapshot,listFiles}=await import('../src/core/store.mjs');
const {indexSnapshot}=await import('../src/repo/index.mjs');
const {askRepository,readSource,rebuildMap}=await import('../src/core/service.mjs');
const {analyse}=await import('../src/core/analyse.mjs');
const {generate}=await import('../src/providers/router.mjs');
const {ProviderError}=await import('../src/providers/gemini.mjs');
const {commandCompletion,nextTypewriterLength,inputViewport,recentPromptHistory,nextChatScroll}=await import('../src/tui.mjs');
const {visualMapUrl}=await import('../src/preview.mjs');

function git(cwd,args){const result=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
async function fixture(){
  const working=path.join(directory,'working'),bare=path.join(directory,'fixture.git');await mkdir(path.join(working,'src'),{recursive:true});
  await writeFile(path.join(working,'package.json'),'{"name":"fixture","type":"module"}\n');
  await writeFile(path.join(working,'src','cors.mjs'),'export function handlePreflight(request) {\n  if (request.method === "OPTIONS") return { status: 204 };\n  return { status: 200 };\n}\n\nexport function validateOrigin(origin) {\n  return origin === "https://example.test";\n}\n');
  await writeFile(path.join(working,'README.md'),'# Fixture\nThis repository has no database implementation.\n');
  git(working,['init']);git(working,['config','user.email','test@example.test']);git(working,['config','user.name','Test']);git(working,['add','.']);git(working,['commit','-m','fixture']);const commit=git(working,['rev-parse','HEAD']);git(directory,['clone','--bare',working,bare]);
  const snapshot={id:'11111111-1111-4111-8111-111111111111',repository:'https://github.com/example/cors-fixture',commitSha:commit,gitDir:bare,status:'acquired',manifest:{}};putSnapshot(snapshot);await indexSnapshot(snapshot.id);return getSnapshot(snapshot.id);
}
const snapshot=await (async()=>{await initialiseStore();return fixture();})();

function fixtureProvider({prompt}){
  const fileId=prompt.match(/FILE_ID ([0-9a-f-]{36})/i)?.[1];const path=prompt.match(/FILE ([^\n]+)\nFILE_ID/)?prompt.match(/FILE ([^\n]+)\nFILE_ID/)[1]:'';return Promise.resolve({text:JSON.stringify({status:'answered',summary:'OPTIONS requests return 204.',claims:[{text:'handlePreflight returns status 204 for OPTIONS requests.',citationFileIds:[fileId]}],limitations:[],followUps:['How is origin validation handled?'],citations:[{fileId,path,startLine:1,endLine:4}]}),usage:{inputTokens:1,outputTokens:1,totalTokens:2}});
}

test('indexes source safely and reads only an indexed file',async()=>{
  const file=listFiles(snapshot.id).find(item=>item.path==='src/cors.mjs');assert.ok(file);const source=await readSource({snapshotId:snapshot.id,fileId:file.id,startLine:1,endLine:4});assert.equal(source.path,'src/cors.mjs');assert.match(source.lines.join('\n'),/handlePreflight/);await assert.rejects(()=>readSource({snapshotId:snapshot.id,fileId:'00000000-0000-4000-8000-000000000000'}));
});

test('validates answers, caches a repeated request and rejects fabricated citations',async()=>{
  let calls=0;const request={repository:snapshot.repository,snapshotId:snapshot.id,question:'How does handlePreflight handle OPTIONS?',testProvider:args=>{calls++;return fixtureProvider(args);}};const first=await askRepository(request);const second=await askRepository(request);assert.equal(first.result.answer.status,'answered');assert.equal(first.result.answer.citations[0].path,'src/cors.mjs');assert.equal(second.result.metadata.cacheHit,true);assert.equal(calls,1);
  await assert.rejects(()=>askRepository({...request,question:'Explain validateOrigin.',testProvider:async()=>({text:JSON.stringify({status:'answered',summary:'Bad answer.',claims:[{text:'Bad.',citationFileIds:['00000000-0000-4000-8000-000000000000']}],limitations:[],followUps:[],citations:[{fileId:'00000000-0000-4000-8000-000000000000',path:'nope.js',startLine:1,endLine:2}]})})}),/evidence validation/);
});

test('answers Medusae map-status questions locally instead of asking the repository model',async()=>{
  await analyse({snapshot,force:true});let calls=0;const result=await askRepository({repository:snapshot.repository,snapshotId:snapshot.id,question:'Have you created the visual map?',testProvider:async()=>{calls++;throw new Error('The provider should not be called.');}});
  assert.equal(result.result.metadata.provider,'local');assert.match(result.result.answer.summary,/created a local visual map/i);assert.equal(calls,0);
});

test('rebuilds a selected snapshot map through the shared service',async()=>{
  const result=await rebuildMap({snapshotId:snapshot.id});
  assert.equal(result.snapshot.id,snapshot.id);assert.ok(result.report.components.length);
});

test('a rebuild without a model keeps the saved map and explains why',async()=>{
  const before=await analyse({snapshot,routes:[]});
  const events=[];
  const result=await rebuildMap({snapshotId:snapshot.id,routes:[],onEvent:event=>events.push(event)});
  assert.equal(result.metadata.rebuilt,false);
  assert.equal(result.metadata.generationMode,'retained');
  assert.match(result.metadata.fallbackReason,/No map route/);
  assert.deepEqual(result.report,before.report);
  assert.ok(events.some(event=>/Keeping your existing map/.test(event.message)));
});

test('answers a simple greeting locally without retrieving or calling a provider',async()=>{
  let calls=0;const result=await askRepository({repository:snapshot.repository,snapshotId:snapshot.id,question:'Heya',testProvider:async()=>{calls++;throw new Error('The provider should not be called.');}});
  assert.equal(result.result.metadata.provider,'local');assert.match(result.result.answer.summary,/I’m Medusae/i);assert.equal(calls,0);
});

test('completes supported model commands for the terminal input',()=>{
  assert.equal(commandCompletion('/model'),'/model gemini gemini-3.8-flash');
  assert.equal(commandCompletion('/model openrouter t'),'/model openrouter thinkingmachines/inkling:free');
  assert.equal(commandCompletion('/models'),'/models');
  assert.equal(commandCompletion('How does this work?'),'');
});

test('reveals model output in bounded typewriter steps',()=>{
  assert.equal(nextTypewriterLength(0,80),1);
  assert.equal(nextTypewriterLength(0,81),2);
  assert.equal(nextTypewriterLength(79,80),80);
  assert.equal(nextTypewriterLength(80,80),80);
});

test('keeps a movable cursor visible and expires old prompt recall entries',()=>{
  assert.deepEqual(inputViewport('abcdefghij',5,6),{text:'bcdefg',cursor:4,start:1,end:7});
  const now=Date.UTC(2026,8,28,12);const history=recentPromptHistory([{role:'user',content:'recent',createdAt:new Date(now-1000).toISOString()},{role:'user',content:'expired',createdAt:new Date(now-25*60*60*1000).toISOString()},{role:'assistant',content:'answer',createdAt:new Date(now).toISOString()}],now,24*60*60*1000);
  assert.deepEqual(history,['recent']);
});

test('keeps transcript scrolling separate from command recall and within its bounds',()=>{
  assert.equal(nextChatScroll(0,3),3);
  assert.equal(nextChatScroll(2,-5),0);
  assert.equal(nextChatScroll(Number.NaN,4),4);
});

test('pins a visual-map link to one saved chat and its snapshot',()=>{
  const url=new URL(visualMapUrl('http://127.0.0.1:3000',{sessionId:'chat-1',snapshotId:'snapshot-1'}));
  assert.equal(url.searchParams.get('sessionId'),'chat-1');
  assert.equal(url.searchParams.get('snapshotId'),'snapshot-1');
});

test('router discards a failed primary attempt before using a fallback',async()=>{
  const events=[];let attempts=0;const result=await generate({prompt:'fixture',responseSchema:{type:'object'},routes:[{id:'primary',provider:'gemini',model:'primary'},{id:'backup',provider:'gemini',model:'backup'}],onEvent:event=>events.push(event.type),testProvider:async({attempt})=>{attempts++;if(attempt===0)throw new ProviderError('quota',{status:429,code:'rate_limit'});return {text:'{}',usage:null};}});
  assert.equal(result.route.id,'backup');assert.equal(attempts,2);assert.deepEqual(events,['route_selected','route_failed','reset','route_selected']);
});

test('router reaches a later configured model after earlier routes are unavailable',async()=>{
  let attempts=0;const routes=['one','two','three','four','five'].map(id=>({id,provider:'gemini',model:id}));const result=await generate({prompt:'fixture',responseSchema:{type:'object'},routes,testProvider:async({attempt})=>{attempts++;if(attempt<4)throw new ProviderError('high demand',{status:503,code:'http_error'});return {text:'{}',usage:null};}});
  assert.equal(result.route.id,'five');assert.equal(attempts,5);
});

test('router retries malformed JSON on the next configured route',async()=>{
  const events=[];const result=await generate({prompt:'fixture',responseSchema:{type:'object'},routes:[{id:'bad-json',provider:'gemini',model:'bad-json'},{id:'good-json',provider:'gemini',model:'good-json'}],onEvent:event=>events.push(event.type),validateResponse:response=>{try{JSON.parse(response.text);}catch{throw new ProviderError('The model returned invalid JSON.',{code:'invalid_schema'});}},testProvider:async({attempt})=>({text:attempt===0?'not json':'{}',usage:null})});
  assert.equal(result.route.id,'good-json');assert.deepEqual(events,['route_selected','route_failed','reset','route_selected']);
});

test('router returns a typed failure when every route fails and never keeps partial text',async()=>{
  const events=[];await assert.rejects(()=>generate({prompt:'fixture',responseSchema:{type:'object'},routes:[{id:'every-primary',provider:'gemini',model:'primary'},{id:'every-backup',provider:'gemini',model:'backup'}],onEvent:event=>events.push(event.type),testProvider:async({attempt})=>{throw new ProviderError(`route ${attempt} stopped after a partial stream`,{code:'network'});}}),error=>error.code==='network');
  assert.deepEqual(events,['route_selected','route_failed','reset','route_selected','route_failed','reset']);
});

test('router drops a simulated halfway stream before a valid fallback answer',async()=>{
  const events=[];const result=await generate({prompt:'fixture',responseSchema:{type:'object'},routes:[{id:'stream-primary',provider:'gemini',model:'primary'},{id:'stream-backup',provider:'gemini',model:'backup'}],onEvent:event=>events.push(event.type),testProvider:async({attempt})=>{if(attempt===0)throw new ProviderError('stream ended before a valid final object',{code:'network'});return {text:'{"status":"answered"}',usage:null};}});
  assert.equal(result.text,'{"status":"answered"}');assert.equal(result.route.id,'stream-backup');assert.deepEqual(events,['route_selected','route_failed','reset','route_selected']);
});

test.after(async()=>{await rm(directory,{recursive:true,force:true});});

 test('OpenRouter is the default and an explicit route stays first',async()=>{
 const {configuredRoutes,routeChain,manualRoute}=await import('../src/core/config.mjs');
 const old={...process.env};try{process.env.OPENROUTER_API_KEY='fixture';process.env.GEMINI_API_KEY='fixture';delete process.env.MEDUSAE_PREFER_OPENROUTER;assert.equal(configuredRoutes()[0].model,'openrouter/free');const chosen=manualRoute('openrouter','test-model:free');assert.equal(routeChain(chosen)[0].model,'test-model:free');}finally{for(const key of ['OPENROUTER_API_KEY','GEMINI_API_KEY','MEDUSAE_PREFER_OPENROUTER']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

test('OpenRouter retries five times without ever invoking Gemini',async()=>{
 const routes=[{id:'retry-openrouter',provider:'compatible',model:'openrouter/free',baseUrl:'https://openrouter.ai/api/v1'},{id:'forbidden-gemini',provider:'gemini',model:'gemini'}];let calls=0;
 const result=await generate({prompt:'retry fixture',routes,testProvider:async({route,attempt})=>{calls++;assert.equal(route.model,'openrouter/free');if(attempt<5)throw new ProviderError('temporary timeout',{code:'timeout',retryAfterMs:0});return {text:'{}'};}});
 assert.equal(calls,6);assert.equal(result.route.model,'openrouter/free');
});
test('OpenRouter authentication failures stop without retries',async()=>{
 let calls=0;await assert.rejects(()=>generate({prompt:'fixture',routes:[{id:'auth-or',model:'openrouter/free',baseUrl:'https://openrouter.ai/api/v1'}],testProvider:async()=>{calls++;throw new ProviderError('unauthorized',{code:'authentication'});}}),/unauthorized/);assert.equal(calls,1);
});

test('provider schema keeps answer structure while local validation retains bounds',async()=>{
 const {providerSchema}=await import('../src/providers/schema.mjs');
 const original={type:'object',required:['format'],additionalProperties:false,properties:{format:{type:'array',maxItems:20,items:{type:'string',format:'uuid',pattern:'complex',maxLength:4096}}}};
 const compact=providerSchema(original);
 assert.deepEqual(compact,{type:'object',required:['format'],additionalProperties:false,properties:{format:{type:'array',items:{type:'string'}}}});
 assert.equal(original.properties.format.items.format,'uuid');
});

test('map routes use Gemini independently of the OpenRouter chat default',async()=>{
 const {mapRoutes,configuredRoutes}=await import('../src/core/config.mjs');
 const keys=['GEMINI_API_KEY','OPENROUTER_API_KEY','MEDUSAE_MAP_MODEL','MEDUSAE_PREFER_OPENROUTER'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.GEMINI_API_KEY='fixture';process.env.OPENROUTER_API_KEY='fixture';process.env.MEDUSAE_MAP_MODEL='map-model';delete process.env.MEDUSAE_PREFER_OPENROUTER;
  assert.equal(configuredRoutes()[0].model,'openrouter/free');
  assert.equal(mapRoutes()[0].model,'map-model');assert.ok(mapRoutes().every(route=>route.provider==='gemini'));
  delete process.env.GEMINI_API_KEY;assert.deepEqual(mapRoutes(),[]);
 }finally{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});

test('S references resolve exact excerpts and reject invented labels',async()=>{
 const {resolveEvidenceReferences}=await import('../src/core/research.mjs');
 const evidence=[{id:'11111111-1111-4111-8111-111111111111',fileId:'22222222-2222-4222-8222-222222222222',path:'src/store.js',startLine:101,endLine:140}];
 const model={status:'answered',summary:'Storage details.',claims:[{text:'The store persists data.',sources:['S1','S1']}],limitations:[],followUps:[]};
 const answer=resolveEvidenceReferences(model,evidence);
 assert.equal(answer.citations.length,1);assert.equal(answer.citations[0].startLine,101);assert.equal(answer.citations[0].path,'src/store.js');assert.equal(answer.claims[0].citationIds[0],answer.citations[0].id);
 assert.throws(()=>resolveEvidenceReferences({...model,claims:[{text:'bad',sources:['S2']}]},evidence),/Unknown evidence reference/);
});

test('map evidence includes every selected file and resolves TypeScript source imports',async()=>{
 const {mapEvidence,resolveImport}=await import('../src/core/analyse.mjs');
 const files=listFiles(snapshot.id),prompt=mapEvidence(snapshot.id,files);
 for(const file of files)assert.ok(prompt.includes(`FILE ${file.id} ${file.path}`));
 assert.equal(resolveImport('src/main.ts','./store.js',new Map([['src/store.ts',{}]])),'src/store.ts');
 assert.equal(resolveImport('src/main.ts','./style.css?inline',new Map([['src/style.css',{}]])),'src/style.css');
 assert.equal(resolveImport('src/main.ts','unknown-package',new Map()),null);
});

test('general concept answers work without indexed evidence and cannot invent citations',async()=>{
 const empty={...snapshot,id:'22222222-2222-4222-8222-222222222222',commitSha:'empty-general-test'};putSnapshot(empty);
 let called=false;
 const result=await askRepository({repository:empty.repository,snapshotId:empty.id,question:'What is a tensor?',testProvider:async({prompt})=>{called=true;assert.match(prompt,/general knowledge/);return {text:JSON.stringify({status:'answered',summary:'In general, a tensor is a multidimensional array of numbers.',claims:[],limitations:[],followUps:[]})};}});
 assert.equal(called,true);assert.equal(result.result.answer.status,'answered');assert.equal(result.result.answer.citations.length,0);
 const {resolveEvidenceReferences}=await import('../src/core/research.mjs');
 assert.throws(()=>resolveEvidenceReferences({status:'answered',summary:'Claim',claims:[{text:'Repo fact',sources:['S1']}],limitations:[],followUps:[]},[]),/Unknown evidence/);
});
test('static file descriptions use source documentation or declared symbols',async()=>{
 const {describeIndexedFile}=await import('../src/core/analyse.mjs');const file={id:'f',path:'tensor.java',language:'Java'};
 assert.match(describeIndexedFile(file,[{fileId:'f',text:'/** Represents multidimensional numeric arrays used by tensor operations. */ class Tensor {}'}]),/multidimensional numeric arrays/);
 assert.match(describeIndexedFile(file,[{fileId:'f',text:'class Tensor {}'}]),/defines Tensor/);
});
