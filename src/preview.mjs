import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function visualMapUrl(previewUrl,{sessionId=null,snapshotId=null}={}){
  const url=new URL(previewUrl);
  if(sessionId)url.searchParams.set('sessionId',sessionId);
  if(snapshotId)url.searchParams.set('snapshotId',snapshotId);
  return url.toString();
}

// A worker keeps Next.js compilation logs out of the full-screen terminal UI.
export async function startPreview() {
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
    cwd: root,
    env: {...process.env, NEXT_TELEMETRY_DISABLED:'1', MEDUSAE_PROJECT_ROOT:root},
    stdio:['ignore','pipe','pipe','ipc']
  });
  let log = '', exited = false;
  worker.stdout.on('data', chunk => { log = (log + chunk).slice(-5000); });
  worker.stderr.on('data', chunk => { log = (log + chunk).slice(-5000); });
  const exit = new Promise(resolve => worker.once('exit', () => { exited = true; resolve(); }));
  let url;
  try {
    url = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Preview startup timed out.')), 60000);
      const finish = (error,value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
      worker.once('error', error => finish(error));
      worker.once('exit', code => finish(new Error(`Preview exited (${code}). ${log}`)));
      worker.once('message', message => message.url ? finish(null,message.url) : finish(new Error(message.error||'Preview failed.')));
    });
  } catch(error) { worker.kill('SIGTERM'); throw error; }
  return {url, async close() {
    if(exited) return;
    if(worker.connected) worker.send({type:'shutdown'});
    const timer = setTimeout(() => worker.kill('SIGTERM'), 3000);
    const force = setTimeout(() => worker.kill('SIGKILL'), 6000);
    await exit; clearTimeout(timer); clearTimeout(force);
  }};
}

async function serve() {
  const {default: next} = await import('next');
  let production = true;
  try { await access(new URL('../.next/BUILD_ID', import.meta.url)); } catch { production = false; }
  const app = next({dev:!production, dir:root, hostname:'127.0.0.1', webpack:true});
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((request,response) => {
    handle(request,response).catch(() => { if(!response.headersSent) response.writeHead(500); response.end('Preview unavailable.'); });
  });
  server.on('upgrade', app.getUpgradeHandler());
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  process.send?.({url:`http://127.0.0.1:${server.address().port}`});
  let stopping = false;
  async function stop() {
    if(stopping) return; stopping = true;
    server.closeAllConnections(); server.close();
    await app.close(); process.exit(0);
  }
  process.on('message', message => { if(message.type==='shutdown') void stop(); });
  process.once('disconnect', () => void stop());
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}
if(process.argv.includes('--worker')) serve().catch(error => { process.send?.({error:error.message}); process.exitCode = 1; });
