'use client';
import {CanvasTexture,Sprite,SpriteMaterial,AdditiveBlending} from 'three';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
const ForceGraph=dynamic(()=>import('react-force-graph-3d'),{ssr:false});
const palette=['#53efbd','#62b3ff','#ffca68','#bc8aff','#ff829e','#53e1ed','#f59661','#a8e36b'];
export default function KnowledgeGraph({components,edges,selectedId,onSelect,onOpenSource,fitRequest=0,repository='Repository'}){
 const lastClick=useRef({id:null,time:0}),focusTimer=useRef(null);
 useEffect(()=>()=>clearTimeout(focusTimer.current),[]);
 const host=useRef(null),graph=useRef(null),fitted=useRef(false);const [size,setSize]=useState({width:800,height:650});
 useEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(host.current);return()=>observer.disconnect();},[]);
 const glow=useMemo(()=>{if(typeof document==='undefined')return null;const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(255,255,255,.55)');gradient.addColorStop(.3,'rgba(255,255,255,.18)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);return new CanvasTexture(canvas);},[]);
 const halos=useRef([]);
 useEffect(()=>()=>{glow?.dispose();halos.current.forEach(material=>material.dispose());},[glow]);
 const makeGlow=useCallback(node=>{const material=new SpriteMaterial({map:glow,color:node.color,transparent:true,opacity:.55,depthWrite:false,blending:AdditiveBlending});halos.current.push(material);const sprite=new Sprite(material);sprite.scale.set(10,10,1);sprite.raycast=()=>{};return sprite;},[glow]);
 useEffect(()=>{if(fitRequest)graph.current?.zoomToFit(500,50);},[fitRequest]);
 const radius=Math.max(45,Math.min(140,9*Math.sqrt(components.length||1)));
 const data=useMemo(()=>{
  let hub='__medusae_project__';while(components.some(c=>c.id===hub))hub+='_';
  const nodes=components.map((c,i)=>{const t=Math.acos(1-2*(i+.5)/Math.max(components.length,1)),p=i*2.399963;return {id:c.id,name:c.name,color:palette[i%palette.length],x:radius*Math.sin(t)*Math.cos(p),y:radius*Math.sin(t)*Math.sin(p),z:radius*Math.cos(t)};});
  const ids=new Set(nodes.map(n=>n.id));
  return {nodes:[{id:hub,name:repository,hub:true,color:'#9affd9',fx:0,fy:0,fz:0},...nodes],links:[...edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>({...e})),...nodes.map(n=>({source:hub,target:n.id,membership:true,label:'belongs to project'}))]};
 },[components,edges,repository,radius]);
 useEffect(()=>{fitted.current=false;},[data]);
 const configureGraph=useCallback(instance=>{graph.current=instance;if(!instance)return;instance.d3Force('charge')?.strength(-8);instance.d3Force('link')?.distance(link=>link.membership?radius:35).strength(link=>link.membership ? .25 : .35);instance.d3ReheatSimulation();},[radius]);
 const related=link=>(link.source.id||link.source)===selectedId||(link.target.id||link.target)===selectedId;
 const clearFocus=()=>{clearTimeout(focusTimer.current);onSelect(null);const instance=graph.current;if(!instance)return;const {x,y,z}=instance.cameraPosition();instance.cameraPosition({x,y,z},{x:0,y:0,z:0},0);};
 const select=node=>{clearTimeout(focusTimer.current);const now=performance.now();if(!node.hub&&lastClick.current.id===node.id&&now-lastClick.current.time<350){lastClick.current={id:null,time:0};onOpenSource?.(node.id);return;}lastClick.current={id:node.id,time:now};if(node.hub){onSelect(null);graph.current?.zoomToFit(600,50);return;}onSelect(node.id);const distance=Math.hypot(node.x,node.y,node.z)||1;const scale=1+100/distance;focusTimer.current=setTimeout(()=>graph.current?.cameraPosition({x:node.x*scale,y:node.y*scale,z:node.z*scale},node,700),350);};
 return <div ref={host} className="knowledge-graph"><ForceGraph showNavInfo={false} ref={configureGraph} width={size.width} height={size.height} graphData={data} backgroundColor="#050708" nodeThreeObject={makeGlow} nodeThreeObjectExtend nodeLabel={node=>{const span=document.createElement('span');span.textContent=node.name;return span;}} nodeColor={n=>n.id===selectedId?'#ffffff':n.color} nodeRelSize={1.8} nodeResolution={20} nodeVal={n=>n.hub?2:n.id===selectedId?1.5:1} nodeOpacity={.95} linkOpacity={.4} linkColor={l=>related(l)?'#b8ffdf':l.membership?'#476875':l.inferred?'#e7ad76':'#8fbfff'} linkWidth={l=>related(l)?.5:l.membership?0:.15} linkDirectionalParticles={l=>related(l)?4:0} linkDirectionalParticleWidth={.8} linkDirectionalParticleSpeed={.008} onNodeClick={select} onBackgroundClick={clearFocus} cooldownTicks={100} onEngineStop={()=>{if(!fitted.current){fitted.current=true;graph.current?.zoomToFit(400,50);}}}/></div>;
}
