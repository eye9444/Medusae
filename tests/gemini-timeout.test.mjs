import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGemini} from '../src/providers/gemini.mjs';

test('Gemini honours per-request timeout overrides and classifies interrupted response bodies',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.GEMINI_API_KEY;
 process.env.GEMINI_API_KEY='test-only';
 try{
  globalThis.fetch=async(_url,{signal})=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>resolve({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{}'}]}}]})}),40);
   signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
  });
  await assert.rejects(()=>generateGemini({model:'fixture',prompt:'test',attemptTimeoutMs:10}),error=>error.code==='timeout');
  assert.equal((await generateGemini({model:'fixture',prompt:'test',attemptTimeoutMs:1000})).text,'{}');
  globalThis.fetch=async(_url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>{
   const timer=setTimeout(resolve,1000);
   signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
  })});
  await assert.rejects(()=>generateGemini({model:'fixture',prompt:'test',attemptTimeoutMs:10}),error=>error.code==='timeout');
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=key;}
});
