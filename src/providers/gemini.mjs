import {getCredential} from '../core/credentials.mjs';
import {providerSchema} from './schema.mjs';
import {settings} from '../core/config.mjs';

export class ProviderError extends Error {
  constructor(message,{status=null,retryAfterMs=null,code='provider_error'}={}){super(message);this.name='ProviderError';this.status=status;this.retryAfterMs=retryAfterMs;this.code=code;}
}
function retryAfter(headers){const raw=headers.get('retry-after');if(!raw)return null;const seconds=Number(raw);return Number.isFinite(seconds)?seconds*1000:null;}
export async function generateGemini({model,prompt,signal,responseSchema,attemptTimeoutMs=settings.attemptTimeoutMs}){
  const key=getCredential('GEMINI_API_KEY');if(!key)throw new ProviderError('GEMINI_API_KEY is not configured.',{code:'missing_credentials'});
  const timeout=AbortSignal.timeout(attemptTimeoutMs);const combined=AbortSignal.any(signal?[signal,timeout]:[timeout]);
  const generationConfig={temperature:0.1,responseMimeType:'application/json'};if(responseSchema)generationConfig.responseJsonSchema=providerSchema(responseSchema);
  let response;try{response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig}),signal:combined});}catch(error){if(error.name==='AbortError'||error.name==='TimeoutError')throw new ProviderError('Gemini request timed out.',{code:'timeout'});throw new ProviderError('Gemini network request failed.',{code:'network'});}
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new ProviderError(body?.error?.message||`Gemini returned HTTP ${response.status}.`,{status:response.status,retryAfterMs:retryAfter(response.headers),code:response.status===429?'rate_limit':response.status===401||response.status===403?'authentication':response.status===404?'model_not_found':'http_error'});}
  let data;try{data=await response.json();}catch(error){if(combined.aborted)throw new ProviderError('Gemini response timed out.',{code:'timeout'});throw new ProviderError('Gemini returned an unreadable response.',{code:'invalid_schema'});}const parts=data?.candidates?.[0]?.content?.parts||[];const text=parts.filter(part=>part.text&&!part.thought).map(part=>part.text).join('');if(!text)throw new ProviderError('Gemini returned no final text.',{code:'empty_response'});return {text,usage:data.usageMetadata?{inputTokens:data.usageMetadata.promptTokenCount??null,outputTokens:data.usageMetadata.candidatesTokenCount??null,totalTokens:data.usageMetadata.totalTokenCount??null}:null};
}
