import {getCredential} from './credentials.mjs';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const defaultData=path.join(projectRoot,'.medusae');

export const settings={
  projectRoot,
  dataDirectory:path.resolve(process.env.MEDUSAE_DATA_DIR||defaultData),
  databaseName:'medusae.sqlite',
  maxFiles:Number(process.env.MEDUSAE_MAX_FILES||2000),
  maxFileBytes:Number(process.env.MEDUSAE_MAX_FILE_BYTES||262144),
  maxIndexBytes:Number(process.env.MEDUSAE_MAX_INDEX_BYTES||20*1024*1024),
  maxRepoBytes:Number(process.env.MEDUSAE_MAX_REPO_BYTES||200*1024*1024),
  acquireTimeoutMs:Number(process.env.MEDUSAE_ACQUIRE_TIMEOUT_MS||120000),
  retrievalChunks:Number(process.env.MEDUSAE_RETRIEVAL_CHUNKS||12),
  retrievalBytes:Number(process.env.MEDUSAE_RETRIEVAL_BYTES||48*1024),
  mapAttemptTimeoutMs:Number(process.env.MEDUSAE_MAP_ATTEMPT_TIMEOUT_MS||180000),
  mapGenerationTimeoutMs:Number(process.env.MEDUSAE_MAP_GENERATION_TIMEOUT_MS||420000),
  attemptTimeoutMs:Number(process.env.MEDUSAE_ATTEMPT_TIMEOUT_MS||45000),
  totalGenerationTimeoutMs:Number(process.env.MEDUSAE_GENERATION_TIMEOUT_MS||120000),
  maxAttempts:Number(process.env.MEDUSAE_MAX_ATTEMPTS||6),
  promptHistoryTtlMs:Math.max(0,Number(process.env.MEDUSAE_PROMPT_HISTORY_TTL_MS||24*60*60*1000)),
  routePolicy:process.env.MEDUSAE_ROUTE_POLICY==='round_robin'?'round_robin':'ordered',
  implementationVersion:'2026-09-29.1'
};

export function modelDefaults(){try{return JSON.parse(readFileSync(path.join(settings.dataDirectory,'model-defaults.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}}
export function saveModelDefault(purpose,provider,model){
 if(!['chat','map'].includes(purpose))throw new Error('Choose chat or map.');
 if(provider!=='auto')manualRoute(provider,model);
 const defaults=modelDefaults();if(provider==='auto')delete defaults[purpose];else defaults[purpose]={provider,model};
 mkdirSync(settings.dataDirectory,{recursive:true});const target=path.join(settings.dataDirectory,'model-defaults.json'),temp=target+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(defaults),{mode:0o600});renameSync(temp,target);return defaults;
}

const defaultGeminiModels=['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-2.5-flash'];
const uniqueModels=models=>[...new Set(models.map(model=>String(model||'').trim()).filter(Boolean))];

export function configuredRoutes(){
  const routes=[];
  const openRouterModel=process.env.OPENROUTER_MODEL||'openrouter/free';
  const openRouter=getCredential('OPENROUTER_API_KEY')?{id:'openrouter-free',provider:'compatible',model:openRouterModel,baseUrl:'https://openrouter.ai/api/v1',keyEnvironment:'OPENROUTER_API_KEY',structured:process.env.OPENROUTER_STRUCTURED==='1',jsonMode:true}:null;
  if(openRouter&&process.env.MEDUSAE_PREFER_OPENROUTER!=='0')routes.push(openRouter);
  if(getCredential('NVIDIA_API_KEY')) routes.push(manualRoute('nvidia',process.env.NVIDIA_MODEL||'nvidia/nemotron-3-super-120b-a12b'));
  if(getCredential('GEMINI_API_KEY')) {
    const models=uniqueModels([process.env.MEDUSAE_GEMINI_MODEL||defaultGeminiModels[0],process.env.MEDUSAE_GEMINI_FALLBACK_MODEL||defaultGeminiModels[1],...(process.env.MEDUSAE_GEMINI_EXTRA_MODELS||defaultGeminiModels.slice(2).join(',')).split(',')]);
    models.forEach((model,index)=>routes.push({id:`gemini-${index+1}`,provider:'gemini',model}));
  }
  if(getCredential('MEDUSAE_COMPATIBLE_API_KEY')&&process.env.MEDUSAE_COMPATIBLE_BASE_URL&&process.env.MEDUSAE_COMPATIBLE_MODEL) {
    routes.push({id:'compatible',provider:'compatible',model:process.env.MEDUSAE_COMPATIBLE_MODEL,baseUrl:process.env.MEDUSAE_COMPATIBLE_BASE_URL,keyEnvironment:'MEDUSAE_COMPATIBLE_API_KEY',structured:process.env.MEDUSAE_COMPATIBLE_STRUCTURED!=='0'});
  }
  if(openRouter&&!routes.includes(openRouter))routes.push(openRouter);
  const selected=modelDefaults().chat;if(selected){try{const preferred=manualRoute(selected.provider,selected.model);return [{...preferred,preferred:true},...routes.filter(r=>r.model!==preferred.model||r.baseUrl!==preferred.baseUrl||r.provider!==preferred.provider)];}catch{/* A deleted key must not prevent opening Settings. */}}
  return routes;
}

// Mapping is selected separately from conversational Q&A.
export function mapRoutes(){
  const saved=modelDefaults().map;if(saved){try{return [{...manualRoute(saved.provider,saved.model),preferred:true}];}catch{return [];}}
  const provider=process.env.MEDUSAE_MAP_PROVIDER||'gemini';
  if(provider==='ollama'||provider==='ollama-cloud'){
    const model=process.env.MEDUSAE_MAP_MODEL||process.env.OLLAMA_MODEL;
    if(!model)return [];
    if(provider==='ollama-cloud'&&!getCredential('OLLAMA_API_KEY'))return [];
    return [{id:provider+'-map',provider:'compatible',model,baseUrl:provider==='ollama-cloud'?'https://ollama.com/v1':(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434/v1'),keyEnvironment:provider==='ollama-cloud'?'OLLAMA_API_KEY':undefined,apiKey:provider==='ollama'?'ollama':undefined,structured:false,jsonMode:false,preferred:true}];
  }

  if(!getCredential('GEMINI_API_KEY'))return [];
  const routes=configuredRoutes().filter(route=>route.provider==='gemini');
  const model=process.env.MEDUSAE_MAP_MODEL;
  return model?[{id:'gemini-map',provider:'gemini',model,preferred:true},...routes.filter(route=>route.model!==model)]:routes;
}

export function routeChain(preferredRoute=null){
  const routes=configuredRoutes();if(!preferredRoute)return routes;
  const sameRoute=route=>route.provider===preferredRoute.provider&&route.model===preferredRoute.model&&route.baseUrl===preferredRoute.baseUrl;
  return [{...preferredRoute,preferred:true},...routes.filter(route=>!sameRoute(route))];
}

export function manualRoute(provider,model){
  const selected=String(provider||'').toLowerCase(),selectedModel=String(model||'').trim();if(!selectedModel)throw new Error('Choose a model ID.');
  if(selected==='ollama'||selected==='ollama-cloud'){if(selected==='ollama-cloud'&&!getCredential('OLLAMA_API_KEY'))throw new Error('OLLAMA_API_KEY is not configured.');return {id:`${selected}-chat-${selectedModel}`,provider:'compatible',model:selectedModel,baseUrl:selected==='ollama'?(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434/v1'):'https://ollama.com/v1',apiKey:selected==='ollama'?'ollama':undefined,keyEnvironment:selected==='ollama-cloud'?'OLLAMA_API_KEY':undefined,structured:false,jsonMode:false};}
  if(selected==='nvidia'){if(!getCredential('NVIDIA_API_KEY'))throw new Error('NVIDIA_API_KEY is not configured.');return {id:`nvidia-manual-${selectedModel}`,provider:'compatible',model:selectedModel,baseUrl:'https://integrate.api.nvidia.com/v1',keyEnvironment:'NVIDIA_API_KEY',structured:false,jsonMode:false};}
  if(selected==='gemini'){if(!getCredential('GEMINI_API_KEY'))throw new Error('GEMINI_API_KEY is not configured.');return {id:`gemini-manual-${selectedModel}`,provider:'gemini',model:selectedModel};}
  if(selected==='openrouter'){if(!getCredential('OPENROUTER_API_KEY'))throw new Error('OPENROUTER_API_KEY is not configured.');return {id:`openrouter-manual-${selectedModel}`,provider:'compatible',model:selectedModel,baseUrl:'https://openrouter.ai/api/v1',keyEnvironment:'OPENROUTER_API_KEY',structured:process.env.OPENROUTER_STRUCTURED==='1',jsonMode:true};}
  if(selected==='compatible'){if(!getCredential('MEDUSAE_COMPATIBLE_API_KEY')||!process.env.MEDUSAE_COMPATIBLE_BASE_URL)throw new Error('The compatible provider is not configured.');return {id:`compatible-manual-${selectedModel}`,provider:'compatible',model:selectedModel,baseUrl:process.env.MEDUSAE_COMPATIBLE_BASE_URL,keyEnvironment:'MEDUSAE_COMPATIBLE_API_KEY',structured:process.env.MEDUSAE_COMPATIBLE_STRUCTURED!=='0'};}
  throw new Error('Provider must be gemini, openrouter, or compatible.');
}

export function publicConfig(){
  return {node:process.version,dataDirectory:settings.dataDirectory,geminiConfigured:Boolean(getCredential('GEMINI_API_KEY')),openRouterConfigured:Boolean(getCredential('OPENROUTER_API_KEY')),compatibleConfigured:Boolean(getCredential('MEDUSAE_COMPATIBLE_API_KEY')&&process.env.MEDUSAE_COMPATIBLE_BASE_URL&&process.env.MEDUSAE_COMPATIBLE_MODEL),routes:configuredRoutes().map(({id,provider,model})=>({id,provider,model}))};
}
