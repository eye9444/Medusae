import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSession,loadSessions,saveSessions,validateRepository} from '../src/sessions.mjs';

test('a saved question survives loading a session again',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'medusae-session-'));
  try {
    assert.deepEqual(await loadSessions(directory),[]);
    const session=createSession('https://github.com/expressjs/cors.git');
    session.messages.push({role:'user',content:'How are preflight requests handled?'});
    await saveSessions([session],directory);
    const loaded=await loadSessions(directory);
    assert.equal(loaded[0].repository,'https://github.com/expressjs/cors');
    assert.equal(loaded[0].messages[0].content,'How are preflight requests handled?');
    loaded[0].messages.push({role:'user',content:'Where is origin validation?'});
    await saveSessions(loaded,directory);
    assert.equal((await loadSessions(directory))[0].messages.length,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('unreadable or unsupported data is reported and preserved',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'medusae-session-'));
  try{
    const file=path.join(directory,'sessions.json');
    for(const content of ['broken json','{"version":99,"sessions":[]}']){
      await writeFile(file,content);
      await assert.rejects(()=>loadSessions(directory),/preserved/);
      assert.equal(await readFile(file,'utf8'),content);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('repository input rejects credentials, non-GitHub hosts and file URLs',()=>{
  for(const value of ['file:///etc/passwd','https://example.com/a/b','https://user:token@github.com/a/b','https://github.com/a/b/tree/main'])assert.throws(()=>validateRepository(value));
});
