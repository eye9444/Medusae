import {getCredential} from '../core/credentials.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {configuredRoutes,settings} from '../core/config.mjs';
import {generateGemini,ProviderError} from './gemini.mjs';
import {generateCompatible} from './compatible.mjs';

const cooldowns=new Map();
let roundRobinOffset=0;
function retryable(error){return ['rate_limit','timeout','network','http_error','model_not_found','empty_response','invalid_schema'].includes(error.code);}
function invocation(route,args){return route.provider==='gemini'?generateGemini({...args,model:route.model}):generateCompatible({...args,model:route.model,baseUrl:route.baseUrl,apiKey:route.keyEnvironment?getCredential(route.keyEnvironment):route.apiKey,structured:route.structured,jsonMode:route.jsonMode});}
export async function generate({prompt,responseSchema,signal,onEvent=()=>{},routes=configuredRoutes(),testProvider=null,validateResponse=null,attemptTimeoutMs=settings.attemptTimeoutMs,totalGenerationTimeoutMs=settings.totalGenerationTimeoutMs}){
  if(!routes.length&&!testProvider)throw new ProviderError('No model route is configured. Set GEMINI_API_KEY or a compatible provider configuration.',{code:'missing_credentials'});
  const openRouter=routes[0]?.baseUrl==='https://openrouter.ai/api/v1';
  const eligible=openRouter?Array.from({length:6},()=>routes[0]):settings.routePolicy==='round_robin'&&!routes[0]?.preferred&&routes.length>1?[...routes.slice(roundRobinOffset%routes.length),...routes.slice(0,roundRobinOffset%routes.length)]:routes;
  if(settings.routePolicy==='round_robin'&&routes.length)roundRobinOffset=(roundRobinOffset+1)%routes.length;
  const deadline=AbortSignal.timeout(openRouter?Math.max(totalGenerationTimeoutMs,attemptTimeoutMs*6+65000):totalGenerationTimeoutMs),combined=AbortSignal.any(signal?[signal,deadline]:[deadline]);let lastError;
  for(let index=0;index<Math.min(openRouter?6:settings.maxAttempts,eligible.length||1);index++){
    if(combined.aborted){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');throw new ProviderError('Model generation exceeded its total time budget.',{code:'timeout'});}const route=eligible[index];const cooldown=cooldowns.get(route?.id);if(!openRouter&&cooldown&&cooldown>Date.now())continue;
    const attemptId=randomUUID();onEvent({type:'route_selected',attemptId,message:`Using ${route?.model||'test provider'}${openRouter?` (attempt ${index+1}/6)`:''}…`});
    try{const result=testProvider?await testProvider({prompt,responseSchema,signal:combined,route,attempt:index}):await invocation(route,{prompt,responseSchema,signal:combined,attemptTimeoutMs});if(validateResponse)await validateResponse(result,{route,attempt:index});return {...result,route,attemptId};}
    catch(error){lastError=error instanceof ProviderError?error:new ProviderError(error.message||'Provider failed.',{code:validateResponse?'invalid_schema':'provider_error'});if(combined.aborted){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');throw new ProviderError('Model generation exceeded its total time budget.',{code:'timeout'});}const wait=lastError.retryAfterMs??(lastError.code==='rate_limit'?30000:5000);if(route&&retryable(lastError))cooldowns.set(route.id,Date.now()+wait);onEvent({type:'route_failed',attemptId,message:lastError.message,data:{code:lastError.code,status:lastError.status}});onEvent({type:'reset',attemptId,message:openRouter?'Discarding incomplete output before retry.':'Discarding incomplete provider output before fallback.'});if(openRouter&&lastError.code==='model_not_found')break;if(!retryable(lastError)||index===Math.min(openRouter?6:settings.maxAttempts,eligible.length||1)-1)break;if(openRouter){const retryDelay=lastError.retryAfterMs??Math.min(1000*2**index,15000);onEvent({type:'phase',message:`Retrying OpenRouter in ${Math.ceil(retryDelay/1000)}s…`});await delay(retryDelay,undefined,{signal:combined});}}
  }
  throw lastError||new ProviderError('All configured model routes are cooling down.',{code:'all_routes_unavailable'});
}
export function routeStatus(){return [...cooldowns].map(([id,until])=>({id,coolingDownUntil:new Date(until).toISOString()}));}
