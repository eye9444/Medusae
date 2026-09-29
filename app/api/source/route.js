import {readSource} from '../../../src/core/service.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){
  const url=new URL(request.url);const snapshotId=url.searchParams.get('snapshotId'),fileId=url.searchParams.get('fileId');
  if(!snapshotId||!fileId)return Response.json({error:'A snapshot and indexed file are required.'},{status:400});
  try{return Response.json(await readSource({snapshotId,fileId,startLine:url.searchParams.get('startLine'),endLine:url.searchParams.get('endLine')}),{headers:{'Cache-Control':'no-store'}});}catch(error){return Response.json({error:error.message},{status:404});}
}
