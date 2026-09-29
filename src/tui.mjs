import {credentialStatus,credentialProviders,saveCredential,deleteCredential,deleteCredentials} from './core/credentials.mjs';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {initialiseStore, listSessions, getSession, openSession, askRepository,rebuildMap,deleteChat} from './core/service.mjs';
import {settings,publicConfig,manualRoute,routeChain,configuredRoutes,modelDefaults,saveModelDefault} from './core/config.mjs';

import {portraits} from './art/medusa.mjs';
export const MEDUSA=portraits[26];

const clean = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const clip = (text,width) => Array.from(clean(text)).slice(0,Math.max(0,width)).join('');
const modelCommands=['/models','/model ollama qwen3:4b','/model ollama gpt-oss:120b-cloud','/model ollama-cloud gpt-oss:120b','/model nvidia nvidia/nemotron-3-super-120b-a12b','/model gemini gemini-3.8-flash','/model gemini gemini-3.7-flash','/model gemini gemini-3.6-flash','/model gemini gemini-2.5-pro','/model gemini gemini-2.5-flash','/model openrouter openrouter/free','/model openrouter thinkingmachines/inkling:free'];
export function commandCompletion(value){const command=String(value).trim();if(!command.startsWith('/'))return '';if(command==='/model')return '/model gemini gemini-3.8-flash';return modelCommands.find(candidate=>candidate.startsWith(command))||'';}
export function defaultModelOptions(routes,ollamaModels=[],saved=null){
 const options=[{label:'Automatic (configured defaults)',value:'auto'}];
 for(const route of routes){const provider=route.provider==='gemini'?'gemini':route.baseUrl?.includes('openrouter.ai')?'openrouter':route.baseUrl?.includes('nvidia.com')?'nvidia':route.baseUrl?.includes('ollama.com')?'ollama-cloud':route.apiKey==='ollama'?'ollama':'compatible';options.push({label:`${provider} · ${route.model}`,value:`${provider} ${route.model}`});}
 for(const model of ollamaModels)options.push({label:`ollama · ${model.name}${model.name.includes('-cloud')?' (cloud)':' (local)'}`,value:`ollama ${model.name}`});
 if(saved)options.push({label:`${saved.provider} · ${saved.model}`,value:`${saved.provider} ${saved.model}`});
 return [...new Map(options.map(option=>[option.value,option])).values(),{label:'Custom provider and model…',value:'custom'}];
}
export function nextTypewriterLength(revealed,total){return Math.min(total,Math.max(0,revealed)+Math.max(1,Math.ceil(total/80)));}
export function inputViewport(value,cursor,width){const characters=Array.from(clean(value)),available=Math.max(1,Number(width)||1),safeCursor=Math.max(0,Math.min(Number(cursor)||0,characters.length));let start=Math.max(0,safeCursor-Math.floor(available*.7));start=Math.min(start,Math.max(0,characters.length-available));const end=Math.min(characters.length,start+available);return {text:characters.slice(start,end).join(''),cursor:safeCursor-start,start,end};}
export function recentPromptHistory(messages,now=Date.now(),ttlMs=24*60*60*1000){const cutoff=now-Math.max(0,ttlMs);return messages.filter(message=>message.role==='user'&&typeof message.content==='string'&&Date.parse(message.createdAt||'')>=cutoff).map(message=>message.content);}
export function nextChatScroll(current,delta){return Math.max(0,(Number.isFinite(current)?current:0)+(Number.isFinite(delta)?delta:0));}
function wrap(text,width) {
  const result=[]; let line='';
  for(const word of clean(text).split(/\s+/)) {
    if(line.length+word.length+1>width && line) { result.push(line); line=''; }
    if(word.length>width) {
      if(line) { result.push(line); line=''; }
      for(let i=0;i<word.length;i+=width) result.push(word.slice(i,i+width));
    } else line+=(line?' ':'')+word;
  }
  if(line) result.push(line); return result;
}

export async function runTui({openPreview}) {
  await initialiseStore();
  let defaultPurpose='chat',deleteTarget=null,modelOptions=[],modelIndex=0;
  let keyIndex=0,keyDeleteAll=false;
  let sessions=listSessions(),page='home',selected=0,input='',cursor=0,active=null,notice='',closed=false,chatScroll=0,pending=null,lastActivity=[],routeOverride=null,animationFrame=0,animationTimer=null,typing=null,typingTimer=null,promptHistoryIndex=-1,promptDraft='';
  const output=process.stdout, terminal=process.stdin, colour=!('NO_COLOR' in process.env);
  const styles=colour?{normal:'\x1b[38;2;164;198;173m',green:'\x1b[38;2;111;239;151m',muted:'\x1b[38;2;105;139;114m',selected:'\x1b[48;2;36;74;46m\x1b[38;2;200;255;215m',rain:'\x1b[38;2;43;75;53m',rainHead:'\x1b[38;2;68;112;79m',title:'\x1b[38;2;169;244;188m'}:{};
  const menu=()=>['New chat',`Continue chat (${sessions.length})`,'Open visual map','Settings','Help','Quit'];
  function openInBrowser(url){try{const command=process.platform==='darwin'?'open':process.platform==='win32'?'cmd':'xdg-open',args=process.platform==='win32'?['/c','start','',url]:[url];const child=spawn(command,args,{detached:true,stdio:'ignore'});child.unref();}catch{}}
  let end; const done=new Promise(resolve=>end=resolve);
  function stop() { if(!closed) { closed=true; end(); } }
  function render() {
    if(closed)return;
    const cols=output.columns||100, rows=output.rows||35;
    if(cols<52||rows<20) { output.write('\x1b[2J\x1b[HMEDUSAE\r\nPlease resize to at least 52 columns x 20 rows.\r\nEsc or Ctrl+C exits.'); return; }
    const width=Math.min(110,cols-4),height=Math.min(37,rows-2),left=Math.max(1,Math.floor((cols-width)/2)),top=Math.max(1,Math.floor((rows-height)/2));
    const cells=Array.from({length:height},()=>Array(width).fill(' ')), tones=Array.from({length:height},()=>Array(width).fill('normal'));
    function put(x,y,text,tone='normal',limit=width-2-x) {
      if(y<0||y>=height)return;
      Array.from(clip(text,limit)).forEach((c,i)=>{if(x+i>=0&&x+i<width){cells[y][x+i]=c;tones[y][x+i]=tone;}});
    }
    function box(x,y,w,h,label='') {
      put(x,y,'┌'+'─'.repeat(w-2)+'┐','muted',w); put(x,y+h-1,'└'+'─'.repeat(w-2)+'┘','muted',w);
      for(let row=y+1;row<y+h-1;row++) { put(x,row,'│','muted',1); put(x+w-1,row,'│','muted',1); }
      if(label)put(x+2,y,` ${label} `,'green',w-4);
    }
    function drawEditor(x,y,fieldWidth,ghost=''){const view=inputViewport(page==='key-entry'?'•'.repeat(Array.from(input).length):input,cursor,fieldWidth-1),characters=Array.from(view.text),before=characters.slice(0,view.cursor).join(''),after=characters.slice(view.cursor).join('');put(x,y,before,'green',fieldWidth);put(x+Array.from(before).length,y,'▌','green',1);put(x+Array.from(before).length+1,y,after,'green',Math.max(0,fieldWidth-Array.from(before).length-1));if(ghost&&cursor===Array.from(input).length)put(x+Array.from(before).length+1,y,ghost,'muted',Math.max(0,fieldWidth-Array.from(before).length-1));}
    box(0,0,width,height,'PROJECT MEDUSAE');
    if(page==='home') {
      if(width>=94&&height>=31) {
        const divider=width-33;
        const art=height>=36?portraits[26]:portraits[21];
        const artX=Math.max(2,Math.floor((divider-art[0].length)/2));
        if(colour&&process.env.MEDUSAE_REDUCED_MOTION!=='1')for(let x=3;x<divider-3;x+=3){
          const head=(Math.floor(rainFrame/(1+x%3))+x*11)%(height+10);
          for(let tail=0;tail<6;tail++){const y=head-tail;if(y<3||y>=height-6)continue;
            const row=art[y-3]||'',leftInk=row.search(/[^ \u2800]/),rightInk=row.trimEnd().length-1;
            if(leftInk>=0&&x>=artX+leftInk-2&&x<=artX+rightInk+2)continue;
            put(x,y,'01:|.*'[Math.abs(x+y+rainFrame)%6],tail===0?'rainHead':'rain',1);
          }
        }
        art.forEach((line,i)=>Array.from(line).forEach((char,j)=>{if(char!==' '&&char!=='\u2800')put(artX+j,3+i,char,'title',1);}));
        put(Math.max(3,Math.floor((divider-15)/2)),height-5,'M E D U S A E','green');
        put(Math.max(3,Math.floor((divider-19)/2)),height-4,'Follow the threads.','muted');
        box(divider,3,30,height-7,'Main menu');
        menu().forEach((label,i)=>put(divider+2,6+i*2,`${selected===i?'›':' '} ${label}`.padEnd(25),selected===i?'selected':'normal',26));
        put(divider+3,height-11,'LOCAL RESEARCH','green',25); put(divider+3,height-9,'Answers cite code','muted',25); put(divider+3,height-8,'Local model configuration','muted',25);
      } else {
        put(4,2,'M E D U S A E','green');
        const art=height>=27?portraits[10]:portraits[7];
        art.forEach((line,i)=>put(3,4+i,line,'title',width-8));
        const menuY=height>=27?15:12;
        menu().forEach((label,i)=>put(5,menuY+i,`${selected===i?'›':' '} ${label}`.padEnd(width-12),selected===i?'selected':'normal'));
      }
      if(notice)put(3,height-3,notice,'green');
    } else if(page==='keys'){
      const state=credentialStatus();put(4,3,'SAVED API KEYS','green');put(4,5,'↑↓ select · Enter add/replace · Delete remove · L location · X delete all','muted');
      state.providers.forEach((p,i)=>put(4,7+i*2,`${keyIndex===i?'›':' '} ${p.label}: ${p.saved?'saved':'not saved'}${p.environment?' (environment override)':''}`,keyIndex===i?'selected':'normal'));
      wrap(state.error||notice||'Keys encrypted locally. Anyone with both storage files can recover them. Saving accepts this risk.',width-10).forEach((line,i)=>put(4,19+i,line,'muted'));
    } else if(page==='key-location'){
      put(4,3,'CREDENTIAL FILES','green');const state=credentialStatus();wrap(`Encrypted keys: ${state.paths.file}\nUnlock key: ${state.paths.unlock}\nOwner-only permissions. Environment overrides are not stored here. Esc returns.`,width-10).forEach((line,i)=>put(4,6+i,line));
    } else if(page==='key-entry'){
      put(4,3,`API KEY: ${credentialProviders[keyIndex][0]}`,'green');put(4,6,'Paste with Ctrl+Shift+V. Enter saves encrypted locally; Esc cancels.','muted');box(3,9,width-6,3,'API key (hidden)');drawEditor(5,10,width-13);wrap(notice||'Local encryption uses a separate local unlock file. Both files grant access to your keys.',width-10).forEach((line,i)=>put(4,14+i,line,'muted'));
    } else if(page==='key-delete'){
      put(4,3,keyDeleteAll?'DELETE ALL SAVED KEYS':`DELETE ${credentialProviders[keyIndex][0]} KEY`,'green');wrap('Enter confirms deletion. Esc cancels. Environment variables are unaffected.',width-10).forEach((line,i)=>put(4,6+i,line));
    } else if(page==='default-model'){
      put(4,3,`DEFAULT ${defaultPurpose.toUpperCase()} MODEL`,'green');
      put(4,5,'↑↓ choose · Enter saves · Esc back','muted');
      const rows=Math.max(1,height-12),offset=Math.max(0,modelIndex-rows+1),saved=modelDefaults()[defaultPurpose],current=saved?`${saved.provider} ${saved.model}`:'auto';
      modelOptions.slice(offset,offset+rows).forEach((option,i)=>put(4,7+i,`${modelIndex===offset+i?'›':' '} ${option.label}${option.value===current?' ✓':''}`.padEnd(width-10),modelIndex===offset+i?'selected':'normal',width-10));
      if(notice)put(4,height-4,notice,'muted');
    } else if(page==='custom-model'){put(4,3,`CUSTOM ${defaultPurpose.toUpperCase()} MODEL`,'green');put(4,6,'Enter provider model-id','muted');box(3,9,width-6,3,'Provider and model');drawEditor(5,10,width-13);if(notice)put(4,height-4,notice,'green');
    } else if(page==='delete-chat'){put(4,3,'DELETE CHAT','green');wrap(deleteTarget?.repository||'',width-10).forEach((line,i)=>put(4,6+i,line));wrap('Enter deletes this chat. Repository data is removed only if no other chat uses it. Esc cancels.',width-10).forEach((line,i)=>put(4,9+i,line));if(notice)put(4,height-4,notice,'green');
    } else if(page==='new') {
      put(4,3,'NEW CHAT','green');
      wrap('Which repository would you like to explore?',width-10).forEach((line,i)=>put(4,6+i,line));
      put(4,9,'https://github.com/owner/repository','muted');
      const fieldY=height>23?12:height-8;
      box(3,fieldY,width-6,3,'Repository');
      drawEditor(5,fieldY+1,width-13);
      put(4,fieldY+3,'Ctrl+Shift+V paste · Enter start · Esc back','muted');
      if(height>23)wrap('Medusae fetches public GitHub source, records a commit, then builds a local map.',width-10).forEach((line,i)=>put(4,20+i,line,'muted'));
      if(pending){const wave=['●···','·●··','··●·','···●','··●·','·●··'][animationFrame%6];put(4,height-5,`${wave} Working · Esc cancels`,'green');}
      if(notice)put(4,height-4,notice,'green');
    } else if(page==='sessions') {
      put(4,3,'CONTINUE CHAT · Delete removes selected chat','green');
      if(!sessions.length)put(4,7,'No saved chats yet. Start a new chat from the menu.','muted');
      const available=height-11,offset=Math.max(0,selected-available+1);
      sessions.slice(offset,offset+available).forEach((session,i)=>put(4,6+i,`${selected===offset+i?'›':' '} ${session.repository.replace('https://github.com/','')}  ·  updated ${session.updatedAt.slice(0,10)}`.padEnd(width-10),selected===offset+i?'selected':'normal'));
    } else if(page==='chat') {
      put(4,2,active.repository.replace('https://github.com/',''),'green'); put(4,4,active.snapshotId?`Commit-pinned research · ${routeOverride?`${routeOverride.provider}/${routeOverride.model}`:'automatic route'}`:'Preparing repository…','muted');
      const lines=[];
      for(const message of active.messages){const isTyping=typing?.messageId===message.id,content=isTyping?Array.from(message.content).slice(0,typing.revealed).join(''):message.content;lines.push(message.role==='user'?'YOU':`MEDUSAE${message.answer?.model?' · '+message.answer.model:''}`,...wrap(content,width-12),'');if(message.answer?.claims&&!isTyping)for(const claim of message.answer.claims)lines.push(...wrap(`• ${claim.text}`,width-12));}
      const showActivity=Boolean(pending||typing),activity=pending?.events||[],activityRows=activity.slice(-3),available=height-(showActivity?20:15),offset=Math.max(0,lines.length-available-chatScroll);const wave=['·  ','·· ','···',' ··','  ·'][animationFrame%5];
      if(!lines.length)put(4,8,'Write your first question below.','muted');
      lines.slice(offset,offset+available).forEach((line,i)=>put(5,7+i,line,line==='YOU'?'green':'normal'));
      if(showActivity){const activityY=height-12;put(4,activityY,pending?`MEDUSAE / WORKING ${wave}`:`MEDUSAE / TYPING ${wave}`,'green');if(activityRows.length)activityRows.forEach((event,index)=>{const marker=event.type==='route_failed'?'!':event.type==='route_selected'?'›':event.type==='reset'?'↻':'·';put(5,activityY+2+index,`${marker} ${event.message||event.type}`,event.type==='route_failed'?'muted':'normal',width-12);});else put(5,activityY+2,pending?'Starting local research…':'Preparing the validated reply…','muted',width-12);}
      box(3,height-7,width-6,3,'Your question');
      const fieldWidth=width-13,completion=commandCompletion(input),ghost=cursor===Array.from(input).length&&completion&&completion.startsWith(input)?clip(completion.slice(input.length),fieldWidth):'';
      drawEditor(5,height-6,fieldWidth,ghost);
      put(4,height-3,typing?'Medusae is typing · Enter reveals the answer':notice||(pending?'Esc cancels research':ghost?'Tab or → completes command · ↑↓ recall · Enter selects':'↑↓ recall · Shift+↑↓ / wheel / PgUp scroll · ←→ edit · Esc menu'),'muted');
    } else {
      put(4,3,page==='settings'?'SETTINGS':page==='map'?'VISUAL EXPLORER':'HELP','green');
      const configured=publicConfig().routes.map(route=>`${route.provider}: ${route.model}`).join(', ')||'No provider key configured.';
      const recallHours=Math.round(settings.promptHistoryTtlMs/3600000);
      const paragraphs=page==='settings'?[`C: set chat default (${modelDefaults().chat?Object.values(modelDefaults().chat).join(' '):'automatic'})`,`M: set map default (${modelDefaults().map?Object.values(modelDefaults().map).join(' '):'automatic'})`,'K: manage saved API keys (add, remove, view location)','Theme: Medusae green','Storage: local SQLite database',`Routes: ${configured}`,'In chat: /model gemini gemini-3.8-flash','In chat: /model openrouter openrouter/free','In chat: /model ollama gpt-oss:120b-cloud','Use /models to inspect configured routes. Tab or Right Arrow completes model commands. Keys can be saved in Settings → K.',`Question recall: ${recallHours} hour${recallHours===1?'':'s'} (MEDUSAE_PROMPT_HISTORY_TTL_MS).`,'NO_COLOR=1 disables colours.']:page==='map'?['Open this address in your browser:',notice,'The map stays local and stops when you quit Medusae.']:['Use Up / Down or j / k to navigate. Press Enter to choose an option.','New chat indexes a public GitHub repository and pins it to a commit. Continue chat reopens saved research.','Open visual map launches the local Next.js explorer. Select a card to understand its role, then View full code to inspect source.','Use Up and Down to recall recent questions; Left and Right move the cursor within the draft. /model selects a route for this terminal session. Tab or → completes commands. Esc cancels an active request.'];
      let y=6;for(const paragraph of paragraphs){for(const line of wrap(paragraph,width-10)){if(y>=height-3)break;put(4,y++,line,page==='map'&&paragraph===notice?'green':'normal');}y++;}
    }
    put(3,height-2,'↑ ↓ navigate   Enter select   Esc back   Ctrl+C quit','muted',width-6);
    let screen='\x1b[H\x1b[2J';
    for(let y=0;y<height;y++) {
      screen+=`\x1b[${top+y};${left}H`;let tone='';
      for(let x=0;x<width;x++){if(tones[y][x]!==tone){tone=tones[y][x];if(colour)screen+='\x1b[0m'+styles[tone];}screen+=cells[y][x];}
      if(colour)screen+='\x1b[0m';
    }
    output.write(screen);
  }
  function startTask(label,work,complete){
    if(pending)return;const controller=new AbortController();pending={controller,label,events:[{type:'phase',message:label}]};animationFrame=0;animationTimer=setInterval(()=>{if(pending?.controller===controller){animationFrame++;render();}},260);notice=label;render();
    work(controller.signal,event=>{if(pending?.controller!==controller)return;const cleanEvent={type:event.type||'phase',message:clean(event.message||event.type)};pending.events=[...pending.events,cleanEvent].slice(-5);notice=cleanEvent.message;render();}).then(value=>{if(pending?.controller!==controller)return;clearInterval(animationTimer);animationTimer=null;lastActivity=[];pending=null;complete(value);render();}).catch(error=>{if(pending?.controller!==controller)return;clearInterval(animationTimer);animationTimer=null;lastActivity=[];pending=null;notice=error.name==='AbortError'?'Research cancelled.':clean(error.message);render();});
  }
  function finishTyping(){if(typingTimer){clearInterval(typingTimer);typingTimer=null;}typing=null;}
  function startTypewriter(message){
    finishTyping();if(!message||message.role!=='assistant'||!message.content)return;
    const total=Array.from(message.content).length;typing={messageId:message.id,revealed:0,total};animationFrame=0;
    typingTimer=setInterval(()=>{if(!typing||typing.messageId!==message.id)return;typing.revealed=nextTypewriterLength(typing.revealed,total);animationFrame++;if(typing.revealed>=total)finishTyping();render();},28);
  }
  function resetPromptRecall(){promptHistoryIndex=-1;promptDraft='';}
  function scrollTranscript(delta){
    if(page!=='chat')return;
    chatScroll=nextChatScroll(chatScroll,delta);
    notice=chatScroll?'Browsing earlier output.':'';
  }
  function recallPrompt(direction){
    const history=recentPromptHistory(active?.messages||[],Date.now(),settings.promptHistoryTtlMs);if(!history.length){notice='No recent question history in the recall window.';return;}
    if(direction<0){if(promptHistoryIndex===-1)promptDraft=input;promptHistoryIndex=Math.min(promptHistoryIndex+1,history.length-1);input=history[history.length-1-promptHistoryIndex];}
    else if(promptHistoryIndex>0){promptHistoryIndex--;input=history[history.length-1-promptHistoryIndex];}
    else if(promptHistoryIndex===0){promptHistoryIndex=-1;input=promptDraft;promptDraft='';}
    cursor=Array.from(input).length;notice=promptHistoryIndex===-1?'Restored draft.':`Recalled question ${promptHistoryIndex+1} of ${history.length}.`;
  }
  async function activate() {
    notice='';
    if(page==='home') {
      const choice=selected; selected=0;input='';cursor=0;resetPromptRecall();
      if(choice===0)page='new';
      if(choice===1){sessions=listSessions();page='sessions';}
      if(choice===2){const target=sessions[0];page='map';notice='Starting the visual explorer…';render();const url=await openPreview(target?{sessionId:target.id,snapshotId:target.snapshotId}:{});openInBrowser(url);notice=target?`Opened ${target.repository.replace('https://github.com/','')} at its pinned commit.`:'Opened the visual explorer. Open a repository to build a map.';}
      if(choice===3)page='settings'; if(choice===4)page='help'; if(choice===5)stop();
    } else if(page==='keys'){page='key-entry';input='';cursor=0;notice='';
    } else if(page==='key-entry'){saveCredential(credentialProviders[keyIndex][1],input);input='';cursor=0;page='keys';notice='Key saved encrypted locally.';
    } else if(page==='key-delete'){if(keyDeleteAll)deleteCredentials();else deleteCredential(credentialProviders[keyIndex][1]);page='keys';notice='Saved credentials deleted. Environment overrides, if any, remain active.';
    } else if(page==='default-model'||page==='custom-model'){const value=page==='default-model'?modelOptions[modelIndex]?.value:input.trim();if(value==='custom'){page='custom-model';input='';cursor=0;notice='';return;}if(!value)return;const [provider,...model]=value.split(/\s+/);saveModelDefault(defaultPurpose,provider,model.join(' '));if(defaultPurpose==='chat')routeOverride=null;page='settings';input='';cursor=0;notice='Default saved.';
    } else if(page==='delete-chat'){const result=await deleteChat(deleteTarget.id);if(active?.id===deleteTarget.id)active=null;sessions=listSessions();selected=0;page='sessions';notice=result.removedRepository?'Chat and repository data deleted.':'Chat deleted; shared repository retained.';
    } else if(page==='sessions'&&sessions.length) { active=getSession(sessions[selected].id);page='chat';input='';cursor=0;chatScroll=0;resetPromptRecall(); }
    else if(page==='new') {
      const repository=input.trim();if(!repository)throw new Error('Enter a public GitHub repository URL.');
      startTask('Preparing repository…',(signal,onEvent)=>openSession({repository,signal,onEvent}),result=>{active=result.session;sessions=listSessions();page='chat';input='';cursor=0;chatScroll=0;resetPromptRecall();notice=`Indexed ${result.indexedFiles} files at ${result.snapshot.commitSha.slice(0,12)}.`;});
    } else if(page==='chat'&&input.trim()) {
      const question=input.trim();input='';cursor=0;chatScroll=0;resetPromptRecall();
      const rebuildRequested=/^\/map\s+(?:rebuild|refresh)$/i.test(question)||/\b(rebuild|recreate|refresh)\b.*\b(?:visual\s+)?(?:map|graph)\b/i.test(question);
      const openMapRequested=/^\/map$/i.test(question)||/\b(open|show)\b.*\b(?:visual\s+)?(?:map|graph)\b/i.test(question);
      if(rebuildRequested){startTask('Rebuilding the visual map…',(signal,onEvent)=>rebuildMap({sessionId:active.id,snapshotId:active.snapshotId,signal,onEvent}),result=>{active=result.session||active;const urlPromise=openPreview({sessionId:active.id,snapshotId:active.snapshotId});void urlPromise.then(url=>{openInBrowser(url);notice='Rebuilt and opened this chat’s visual map.';render();}).catch(error=>{notice=clean(error.message);render();});});return;}
      if(openMapRequested){const url=await openPreview({sessionId:active.id,snapshotId:active.snapshotId});openInBrowser(url);notice='Opened this chat’s visual map in your browser.';return;}
      if(question==='/models'){const routes=publicConfig().routes.map(route=>`${route.provider}/${route.model}`).join(' · ')||'No configured routes.';lastActivity=[{type:'phase',message:`Available: ${routes}`}];notice='Use /model <provider> <model-id> to select one.';return;}
      if(question.startsWith('/model')){const selectedCommand=question;const [,provider,...modelParts]=selectedCommand.split(/\s+/);routeOverride=manualRoute(provider,modelParts.join(' '));lastActivity=[{type:'phase',message:`Selected ${routeOverride.provider}/${routeOverride.model} for this terminal session.`}];notice='Route selected. Your next question will use it.';return;}
      startTask('Finding source evidence…',(signal,onEvent)=>askRepository({repository:active.repository,question,sessionId:active.id,snapshotId:active.snapshotId,signal,onEvent,routes:routeOverride?routeChain(routeOverride):null}),result=>{active=result.session;sessions=listSessions();notice=result.result.metadata.provider==='local'?'Updated from the local visual map.':result.result.metadata.cacheHit?'Loaded cached answer.':`Answered with ${result.result.metadata.model}.`;startTypewriter(active.messages.at(-1));});
    }
  }
  async function onKey(text,key={}) {
    if(closed)return;
    if((key.ctrl&&key.name==='c')||(key.ctrl&&key.name==='d')){stop();return;}
    if(key.name==='escape'){if(pending){pending.controller.abort();notice='Cancelling research…';render();return;}finishTyping();if(page==='home')stop();else{page=['key-entry','key-location','key-delete'].includes(page)?'keys':page==='keys'?'settings':page==='custom-model'?'default-model':page==='default-model'?'settings':'home';selected=0;notice='';input='';cursor=0;resetPromptRecall();}render();return;}
    if(typing&&(key.name==='return'||key.name==='tab'||key.name==='backspace'||text)){finishTyping();notice='';render();return;}
    if(page==='settings'&&text==='k'){page='keys';notice='';render();return;}
    if(page==='keys'){
      if(['up','down'].includes(key.name)){keyIndex=(keyIndex+(key.name==='up'?-1:1)+credentialProviders.length)%credentialProviders.length;render();return;}
      if(text==='l'){page='key-location';render();return;}
      if(text==='x'||key.name==='delete'){keyDeleteAll=text==='x';page='key-delete';render();return;}
    }
    if(page==='settings'&&(text==='c'||text==='m')){defaultPurpose=text==='c'?'chat':'map';page='default-model';input='';cursor=0;modelIndex=0;modelOptions=defaultModelOptions(configuredRoutes(),[],modelDefaults()[defaultPurpose]);notice='Checking installed Ollama models…';render();try{const base=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434/v1';const url=base.replace(/\/v1\/?$/,'')+'/api/tags';const response=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('Ollama unavailable');const data=await response.json();if(page==='default-model'){modelOptions=defaultModelOptions(configuredRoutes(),data.models||[],modelDefaults()[defaultPurpose]);notice='Configured routes and installed models. Custom accepts any model ID.';}}catch{if(page==='default-model')notice='Ollama unavailable. Configured routes and Custom remain available.';}render();return;}
    if(page==='sessions'&&key.name==='delete'&&sessions[selected]){deleteTarget=sessions[selected];page='delete-chat';render();return;}
    if(page==='default-model'&&['up','down'].includes(key.name)){modelIndex=(modelIndex+(key.name==='up'?-1:1)+modelOptions.length)%modelOptions.length;render();return;}
    if(key.name==='return'){try{await activate();}catch(error){notice=clean(error.message);}render();return;}
    if(page==='new'||page==='chat'||page==='custom-model'||page==='key-entry') {
      if(page==='chat'&&key.ctrl&&key.name==='home')chatScroll=Number.MAX_SAFE_INTEGER;
      else if(page==='chat'&&key.ctrl&&key.name==='end')chatScroll=0;
      else if(page==='chat'&&(key.name==='pageup'||(key.ctrl&&key.name==='up')||(key.shift&&key.name==='up')))scrollTranscript(5);
      else if(page==='chat'&&(key.name==='pagedown'||(key.ctrl&&key.name==='down')||(key.shift&&key.name==='down')))scrollTranscript(-5);
      else if(page==='chat'&&key.name==='up')recallPrompt(-1);
      else if(page==='chat'&&key.name==='down')recallPrompt(1);
      else if(key.name==='left')cursor=Math.max(0,cursor-1);
      else if(key.name==='right'){const completion=page==='chat'&&cursor===Array.from(input).length&&!key.ctrl&&!key.meta&&!key.shift?commandCompletion(input):'';if(completion&&completion!==input&&completion.startsWith(input)){input=completion;cursor=Array.from(input).length;resetPromptRecall();notice='Command completed. Enter selects it.';}else cursor=Math.min(Array.from(input).length,cursor+1);}
      else if(key.name==='home'&&!key.ctrl)cursor=0;
      else if(key.name==='end'&&!key.ctrl)cursor=Array.from(input).length;
      else if(page==='chat'&&key.name==='tab'){const completion=commandCompletion(input);if(completion&&completion!==input){input=completion;cursor=Array.from(input).length;resetPromptRecall();notice='Command completed. Enter selects it.';}}
      else if(key.name==='backspace'&&cursor>0){const characters=Array.from(input);characters.splice(cursor-1,1);input=characters.join('');cursor--;resetPromptRecall();}
      else if(key.name==='delete'){const characters=Array.from(input);characters.splice(cursor,1);input=characters.join('');resetPromptRecall();}
      else if(text&&!key.ctrl&&!key.meta&&!['up','down','left','right'].includes(key.name)){const characters=Array.from(input),inserted=Array.from(clean(text));characters.splice(cursor,0,...inserted);input=characters.slice(0,2000).join('');cursor=Math.min(cursor+inserted.length,Array.from(input).length);resetPromptRecall();}
    } else {
      const length=page==='home'?menu().length:page==='sessions'?sessions.length:0;
      if(length&&(key.name==='down'||text==='j'))selected=(selected+1)%length;
      if(length&&(key.name==='up'||text==='k'))selected=(selected-1+length)%length;
    }
    render();
  }
  let rainFrame=0;
  const rainTimer=colour&&process.env.MEDUSAE_REDUCED_MOTION!=='1'?setInterval(()=>{if(page==='home'&&!closed){rainFrame++;render();}},180):null;
  let chain=Promise.resolve();
  let discardingMouseReport=false;
  const listener=(text,key)=>{
    // Node's readline expands an SGR mouse report into individual keypresses.
    // Consume the whole report here so its button and coordinate bytes never
    // become part of the chat draft.
    const sequence=String(key?.sequence??text??'');
    if(sequence==='\x1b[<'){discardingMouseReport=true;return;}
    if(discardingMouseReport){if(sequence==='M'||sequence==='m')discardingMouseReport=false;return;}
    chain=chain.then(()=>onKey(text,key)).catch(error=>{notice=clean(error.message);render();});
  };
  let mouseBuffer='';
  const mouseListener=chunk=>{
    mouseBuffer+=(Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk));
    const matcher=/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;let match;
    while((match=matcher.exec(mouseBuffer))){
      if(page==='chat'&&match[4]==='M'){
        if(Number(match[1])===64)scrollTranscript(3);
        if(Number(match[1])===65)scrollTranscript(-3);
      }
    }
    mouseBuffer=mouseBuffer.slice(-24);
    render();
  };
  readline.emitKeypressEvents(terminal);terminal.setRawMode(true);terminal.resume();output.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');
  terminal.on('keypress',listener);terminal.on('data',mouseListener);output.on('resize',render);process.once('SIGTERM',stop);render();
  try {await done;} finally {
    clearInterval(rainTimer);clearInterval(animationTimer);clearInterval(typingTimer);terminal.off('keypress',listener);terminal.off('data',mouseListener);output.off('resize',render);process.off('SIGTERM',stop);
    terminal.setRawMode(false);terminal.pause();output.write('\x1b[0m\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
  }
}
