'use client';
import {useState} from 'react';
export default function ChatPanel({messages=[],pendingQuestion='',asking=false,onSource,onFollowUp,question,onQuestion,onSubmit,busy}){
 const [mode,setMode]=useState('normal');
 if(!messages.length&&!asking)return null;
 return <section className={`conversation-panel ${mode}`} aria-label="Medusae conversation">
 <header><strong>Conversation <small>{messages.length} messages</small></strong><div><button onClick={()=>setMode(mode==='collapsed'?'normal':'collapsed')} aria-label={mode==='collapsed'?'Expand conversation':'Minimize conversation'}>{mode==='collapsed'?'Expand':'Minimize'}</button>{mode!=='collapsed'&&<button onClick={()=>setMode(mode==='maximized'?'normal':'maximized')}>{mode==='maximized'?'Restore':'Maximize'}</button>}</div></header>
 {mode!=='collapsed'&&<div className="conversation-scroll">{messages.map((message,index)=><article key={message.id||index}><h3>{message.role==='user'?'You':'Medusae'}{message.answer?.model&&<small> · {message.answer.model}</small>}</h3><p>{message.content}</p>{message.answer?.claims?.length>0&&<ul>{message.answer.claims.map((claim,i)=><li key={i}>{claim.text}</li>)}</ul>}{message.answer?.citations?.map((citation,i)=><button key={i} onClick={()=>onSource(citation)}>{citation.path}:{citation.startLine}–{citation.endLine}</button>)}{message.answer?.followUps?.map((question,i)=><button key={`follow-${i}`} className="follow-up" onClick={()=>onFollowUp(question)}>{question}</button>)}</article>)}{asking&&<article aria-live="polite"><h3>You</h3><p>{pendingQuestion}</p><p>Medusae is thinking…</p></article>}</div>}
 {mode!=='collapsed'&&<form className="conversation-composer" onSubmit={onSubmit}><input aria-label="Follow-up question" placeholder="Ask a follow-up…" value={question} onChange={event=>onQuestion(event.target.value)}/><button disabled={busy||!question.trim()}>Send</button></form>}
 </section>;
}
