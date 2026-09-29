import test from 'node:test';
import assert from 'node:assert/strict';

// This never reads a key file. Run it only with an explicitly supplied environment key:
// MEDUSAE_LIVE_TEST=1 GEMINI_API_KEY=... npm run live-test
const enabled=process.env.MEDUSAE_LIVE_TEST==='1'&&Boolean(process.env.GEMINI_API_KEY);

test('live Gemini research answers one commit-pinned CORS question', {skip:!enabled}, async()=>{
  const {askRepository}=await import('../src/core/service.mjs');
  const result=await askRepository({repository:'https://github.com/expressjs/cors',question:'How are preflight requests handled?'});
  assert.equal(result.result.answer.status,'answered');
  assert.ok(result.result.answer.citations.some(citation=>citation.path==='lib/index.js'));
  assert.match(result.snapshot.commitSha,/^[0-9a-f]{40}$/);
});
