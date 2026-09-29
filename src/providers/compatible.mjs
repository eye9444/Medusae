import {getCredential} from '../core/credentials.mjs';
import {providerSchema} from './schema.mjs';
import {settings} from '../core/config.mjs';
import {ProviderError} from './gemini.mjs';

export async function generateCompatible({model,prompt,signal,responseSchema,apiKey,baseUrl,structured=true,jsonMode=false,attemptTimeoutMs=settings.attemptTimeoutMs}){
  const key=apiKey||getCredential('MEDUSAE_COMPATIBLE_API_KEY'),base=baseUrl||process.env.MEDUSAE_COMPATIBLE_BASE_URL;if(!key||!base)throw new ProviderError('Compatible provider is not configured.',{code:'missing_credentials'});
  const timeout=AbortSignal.timeout(attemptTimeoutMs);const combined=AbortSignal.any(signal?[signal,timeout]:[timeout]);
  const useSchema=structured&&Boolean(responseSchema);const body={model,temperature:0.1,messages:[{role:'user',content:useSchema?prompt:`${prompt}\n\nReturn only one JSON object that matches the requested answer shape.`}]};if(useSchema)body.response_format={type:'json_schema',json_schema:{name:'medusae_response',strict:true,schema:providerSchema(responseSchema)}};else if(jsonMode)body.response_format={type:'json_object'};
  let response;try{response=await fetch(`${base.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify(body),signal:combined});}catch(error){if(error.name==='AbortError'||error.name==='TimeoutError')throw new ProviderError('Compatible provider request timed out.',{code:'timeout'});throw new ProviderError('Compatible provider network request failed.',{code:'network'});}
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new ProviderError(body?.error?.message||`Compatible provider returned HTTP ${response.status}.`,{status:response.status,retryAfterMs:null,code:response.status===429?'rate_limit':response.status===401||response.status===403?'authentication':response.status===404?'model_not_found':'http_error'});}
  const data=await response.json();const text=data?.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw new ProviderError('Compatible provider returned no final text.',{code:'empty_response'});return {text,model:typeof data.model==='string'?data.model:model,usage:data.usage?{inputTokens:data.usage.prompt_tokens??null,outputTokens:data.usage.completion_tokens??null,totalTokens:data.usage.total_tokens??null}:null};
}
