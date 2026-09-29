#!/usr/bin/env node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {askRepository} from './core/service.mjs';

const server=new McpServer({name:'project-medusae',version:'0.1.0'});
server.registerTool('research_repo',{
  description:'Research a public GitHub repository from indexed source code. Returns a compact answer with commit-pinned citations. It may make configured remote model requests and writes a local cache.',
  inputSchema:{repository:z.string().url().describe('Public https://github.com/owner/repository URL.'),question:z.string().min(1).max(4000).describe('Question about repository implementation.'),sessionId:z.string().uuid().optional().describe('Optional Medusae session ID.'),snapshotId:z.string().uuid().optional().describe('Optional pinned snapshot ID for the same repository.')},
  outputSchema:{status:z.string(),summary:z.string(),commit:z.string(),citations:z.array(z.object({path:z.string(),startLine:z.number(),endLine:z.number(),url:z.string()})),limitations:z.array(z.string()),cacheHit:z.boolean(),model:z.string().nullable()}
},async input=>{
  try{
    const result=await askRepository({...input,onEvent:event=>{if(event.type==='route_selected'||event.type==='route_failed')console.error(`[medusae] ${event.message}`);}});
    const {answer,metadata}=result.result;const citations=answer.citations.map(citation=>({path:citation.path,startLine:citation.startLine,endLine:citation.endLine,url:`${result.snapshot.repository}/blob/${result.snapshot.commitSha}/${citation.path}#L${citation.startLine}-L${citation.endLine}`}));
    const structuredContent={status:answer.status,summary:answer.summary,commit:result.snapshot.commitSha,citations,limitations:answer.limitations,cacheHit:Boolean(metadata.cacheHit),model:metadata.model||null};
    return {content:[{type:'text',text:JSON.stringify(structuredContent,null,2)}],structuredContent};
  }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({error:error.message||'Repository research failed.'})}]};}
});
const transport=new StdioServerTransport();await server.connect(transport);console.error('Medusae MCP server is running on stdio.');
