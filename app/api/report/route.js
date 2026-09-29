import {getReport,getSnapshot,listFiles} from '../../../src/core/store.mjs';
import {linkedFiles} from '../../../src/core/analyse.mjs';
import {getSession,initialiseStore,rebuildMap} from '../../../src/core/service.mjs';

export const runtime='nodejs';export const dynamic='force-dynamic';
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return ['localhost','127.0.0.1'].includes(new URL(origin).hostname);}catch{return false;}}
export async function GET(request){await initialiseStore();const url=new URL(request.url),sessionId=url.searchParams.get('sessionId'),requestedSnapshotId=url.searchParams.get('snapshotId'),session=sessionId?getSession(sessionId):null;if(sessionId&&!session)return Response.json({error:'Session not found.'},{status:404});if(session&&requestedSnapshotId&&session.snapshotId!==requestedSnapshotId)return Response.json({error:'The requested snapshot does not belong to this chat.'},{status:400});const snapshotId=requestedSnapshotId||session?.snapshotId;if(!snapshotId)return Response.json({error:'A session or snapshot is required.'},{status:400});const snapshot=getSnapshot(snapshotId),report=getReport(snapshotId);if(!snapshot||!report)return Response.json({error:'No report exists for that snapshot.'},{status:404});const files=listFiles(snapshotId);return Response.json({session,snapshot,report:report.report,files,fileEdges:linkedFiles(snapshotId,files)},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request){
  if(!sameOrigin(request))return Response.json({error:'Local same-origin requests only.'},{status:403});
  let body;try{body=await request.json();}catch{return Response.json({error:'Invalid request.'},{status:400});}
  const run=async onEvent=>{
    const result=await rebuildMap({sessionId:body.sessionId,snapshotId:body.snapshotId,onEvent,signal:request.signal});
    const files=listFiles(result.snapshot.id);
    const {report:unused,...metadata}=result.metadata;
    return {session:result.session,snapshot:result.snapshot,report:result.report,files,fileEdges:linkedFiles(result.snapshot.id,files),metadata};
  };
  if(request.headers.get('accept')==='application/x-ndjson'){
    const encoder=new TextEncoder();
    const stream=new ReadableStream({async start(controller){
      const send=value=>{if(!request.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(value)+'\n'));};
      try{const result=await run(event=>{if(event.message)send({type:'progress',message:event.message});});send({type:'result',result});}
      catch(error){send({type:'error',error:error.message});}
      finally{controller.close();}
    }});
    return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
  }
  try{return Response.json(await run(()=>{}));}catch(error){return Response.json({error:error.message},{status:400});}
}
