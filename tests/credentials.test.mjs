import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {credentialPaths,saveCredential,getCredential,deleteCredential,deleteCredentials,credentialStatus} from '../src/core/credentials.mjs';
test('encrypted credentials round-trip, overrides, tampering and deletion',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'medusae-keys-')),previous=process.env.MEDUSAE_CREDENTIALS_DIR,envKey=process.env.GEMINI_API_KEY;
 process.env.MEDUSAE_CREDENTIALS_DIR=dir;delete process.env.GEMINI_API_KEY;
 try{
 saveCredential('GEMINI_API_KEY','test-gemini-secret');saveCredential('OPENROUTER_API_KEY','test-openrouter-secret');
 const p=credentialPaths(),raw=readFileSync(p.file,'utf8');assert.ok(!raw.includes('test-gemini-secret'));assert.equal(getCredential('GEMINI_API_KEY'),'test-gemini-secret');assert.equal(statSync(p.file).mode&0o777,0o600);assert.equal(statSync(p.unlock).mode&0o777,0o600);
 process.env.GEMINI_API_KEY='override';assert.equal(getCredential('GEMINI_API_KEY'),'override');delete process.env.GEMINI_API_KEY;
 deleteCredential('OPENROUTER_API_KEY');assert.equal(credentialStatus().providers.find(p=>p.name==='OPENROUTER_API_KEY').saved,false);assert.equal(getCredential('GEMINI_API_KEY'),'test-gemini-secret');
 const intact=readFileSync(p.file,'utf8'),bad=JSON.parse(intact);bad.tag=Buffer.alloc(16).toString('base64');writeFileSync(p.file,JSON.stringify(bad));assert.match(credentialStatus().error,/Cannot unlock/);assert.throws(()=>saveCredential('GEMINI_API_KEY','new'),/Cannot unlock/);
 writeFileSync(p.file,intact);deleteCredential('GEMINI_API_KEY');assert.equal(existsSync(p.file),false);assert.equal(existsSync(p.unlock),false);
 saveCredential('GEMINI_API_KEY','again');deleteCredentials();assert.equal(existsSync(p.file),false);deleteCredentials();
 }finally{if(previous===undefined)delete process.env.MEDUSAE_CREDENTIALS_DIR;else process.env.MEDUSAE_CREDENTIALS_DIR=previous;if(envKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=envKey;rmSync(dir,{recursive:true,force:true});}
});
