import {listFiles} from '../../../src/core/store.mjs';
import {linkedFiles} from '../../../src/core/analyse.mjs';
import {listSessions,openSession,getSession,initialiseStore} from '../../../src/core/service.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return ['localhost','127.0.0.1'].includes(new URL(origin).hostname);}catch{return false;}}
export async function GET(request){await initialiseStore();const id=new URL(request.url).searchParams.get('id');return Response.json(id?getSession(id):listSessions(),{headers:{'Cache-Control':'no-store'}});}
export async function POST(request){if(!sameOrigin(request))return Response.json({error:'Local same-origin requests only.'},{status:403});try{const body=await request.json();const result=await openSession({repository:body.repository});return Response.json({session:result.session,snapshot:result.snapshot,report:result.report,files:listFiles(result.snapshot.id),fileEdges:linkedFiles(result.snapshot.id,listFiles(result.snapshot.id))},{status:201});}catch(error){return Response.json({error:error.message},{status:400});}}
