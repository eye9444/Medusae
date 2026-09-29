import readline from 'node:readline';
import {startPreview,visualMapUrl} from './preview.mjs';
import {runTui} from './tui.mjs';
import {doctor,openSession,askRepository,refreshSession} from './core/service.mjs';
import {manualRoute,publicConfig,routeChain} from './core/config.mjs';

let preview;
async function openPreview(context={}) { preview ??= await startPreview(); return visualMapUrl(preview.url,context); }
async function shutdown() { if(preview) await preview.close(); }

function eventWriter(json){return event=>{if(json)return;process.stderr.write(`${event.message||event.type}\n`);};}
function parseArguments(args){const values=[],options={json:false,provider:null,model:null};for(let index=0;index<args.length;index++){const value=args[index];if(value==='--json'){options.json=true;continue;}if(value==='--provider'||value==='--model'){const next=args[++index];if(!next)throw new Error(`${value} needs a value.`);options[value.slice(2)]=next;continue;}values.push(value);}return {values,...options};}
async function commandMode(){
  const [, , command, ...args]=process.argv;const {json,values,provider,model}=parseArguments(args);
  if(command==='doctor'){const result=await doctor();console.log(JSON.stringify(result,null,2));return;}
  if(command==='models'){console.log(JSON.stringify({routes:publicConfig().routes,usage:'ask <repository> <question> --provider gemini|openrouter|compatible --model <model-id>'},null,2));return;}
  if(command==='open'){const repository=values[0];if(!repository)throw new Error('Usage: node src/cli.mjs open https://github.com/owner/repository');const result=await openSession({repository,onEvent:eventWriter(json)});console.log(json?JSON.stringify({session:result.session,snapshot:result.snapshot,report:result.report},null,2):`Opened ${result.session.repository}\nCommit ${result.snapshot.commitSha}\nIndexed ${result.indexedFiles} files\nSession ${result.session.id}`);return;}
  if(command==='ask'){const repository=values[0],question=values.slice(1).join(' ');if(Boolean(provider)!==Boolean(model))throw new Error('Use --provider and --model together.');if(!repository||!question)throw new Error('Usage: node src/cli.mjs ask https://github.com/owner/repository "question" --provider openrouter --model openrouter/free --json');const routes=provider?routeChain(manualRoute(provider,model)):null;const result=await askRepository({repository,question,onEvent:eventWriter(json),routes});if(json)console.log(JSON.stringify({answer:result.result.answer,metadata:result.result.metadata,snapshot:result.snapshot},null,2));else{console.log(result.result.answer.summary);for(const claim of result.result.answer.claims)console.log(`\n• ${claim.text}`);if(result.result.answer.citations.length)console.log(`\nCommit ${result.snapshot.commitSha}`);}return;}
  if(command==='refresh'){const sessionId=values[0];if(!sessionId)throw new Error('Usage: node src/cli.mjs refresh <session-id>');const result=await refreshSession(sessionId,{onEvent:eventWriter(json)});console.log(json?JSON.stringify(result,null,2):`Refreshed ${result.snapshot.commitSha}`);return;}
  throw new Error('Commands: doctor, models, open <repository>, ask <repository> <question> [--provider name --model id] --json, refresh <session-id>, preview.');
}
if(process.argv.includes('--preview')||process.argv[2]==='preview') {
  try {
    const url=await openPreview();
    console.log(`MEDUSAE · Visual explorer\n${url}\nPress Ctrl+C to stop.`);
    process.once('SIGINT',()=>void shutdown()); process.once('SIGTERM',()=>void shutdown());
  } catch(error) { console.error(error.message); process.exitCode=1; }
} else if(['doctor','models','open','ask','refresh'].includes(process.argv[2])) {
  try { await commandMode(); } catch(error) { console.error(error.message); process.exitCode=1; }
} else if(process.stdin.isTTY && process.stdout.isTTY) {
  try { await runTui({openPreview}); } catch(error) { console.error(error.message); process.exitCode=1; }
  finally { await shutdown(); }
} else {
  console.log('MEDUSAE · Plain terminal mode\nCommands: preview, doctor, help, exit. Run in an interactive terminal for the full-screen menu.');
  const input=readline.createInterface({input:process.stdin});
  try {
    for await(const line of input) {
      const command=line.trim().toLowerCase();
      if(command==='exit'||command==='quit')break;
      if(command==='preview')console.log(await openPreview());
      else if(command==='doctor')console.log(JSON.stringify(await doctor(),null,2));
      else console.log('preview — visual explorer; doctor — inspect local setup; exit — quit. Full-screen chat sessions require an interactive terminal.');
    }
  } finally { input.close(); await shutdown(); }
}
