import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { localTokenNextScanDelay } from './usage/scheduling.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid=n=>Number.isSafeInteger(n)&&n>=0;
const field=(v,camel,snake)=>valid(v?.[camel]??v?.[snake])?v[camel]??v[snake]:null;
const emptyDetails=()=>({inputTokens:null,cachedInputTokens:null,uncachedInputTokens:null,outputTokens:null,contextTokens:null,contextWindow:null});
export function parseLocalTokenUsageEvent(line) {
 let item;try{item=JSON.parse(String(line));}catch{return null;}
 const p=item.payload;if(item.type!=='event_msg'||p?.type!=='token_count')return null;
 const timestamp=Date.parse(item.timestamp);if(!Number.isFinite(timestamp))return null;
 const last=p.info?.last_token_usage??p.tokenUsage?.last,total=p.info?.total_token_usage??p.tokenUsage?.total;
 const tokens=field(last,'totalTokens','total_tokens');if(tokens===null)return null;
 return {timestamp,tokens,totalTokens:field(total,'totalTokens','total_tokens'),inputTokens:field(last,'inputTokens','input_tokens'),cachedInputTokens:field(last,'cachedInputTokens','cached_input_tokens'),outputTokens:field(last,'outputTokens','output_tokens'),contextTokens:tokens,contextWindow:field(p.info??p.tokenUsage,'modelContextWindow','model_context_window'),identity:createHash('sha256').update(JSON.stringify([timestamp,last,total])).digest('hex')};
}
function uuidTime(id) {if(String(id)[14]!=='7')return null;const n=Number.parseInt(String(id).replaceAll('-','').slice(0,12),16);return Number.isSafeInteger(n)?n:null;}
function discover(root) {
 const files=[];
 if(!root||!fs.existsSync(root))return files;
 const pending=[root];
 while(pending.length){const dir=pending.pop();let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
  for(const e of entries){const file=path.join(dir,e.name);if(e.isDirectory())pending.push(file);else if(e.isFile()&&/^rollout-.*\.jsonl$/i.test(e.name))files.push(file);}}
 return files;
}
function header(file) {
 let fd;try{fd=fs.openSync(file,'r');const b=Buffer.alloc(65536);const length=fs.readSync(fd,b,0,b.length,0);for(const line of b.subarray(0,length).toString('utf8').split('\n')){let item;try{item=JSON.parse(line);}catch{continue;}if(item.type==='session_meta'&&UUID.test(item.payload?.id)){return {id:item.payload.id.toLowerCase(),forked:Boolean(item.payload.forked_from_id??item.payload.parent_session_id??item.payload.parent_thread_id),timestamp:uuidTime(item.payload.id)??Date.parse(item.timestamp)};}}}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}return null;
}
export class LocalSessionTracker {
 constructor({sessionRoot=process.env.CODEX_USAGE_SESSION_ROOT||path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions'),now=Date.now,onUpdate=()=>{}}={}) {
  this.sessionRoot=sessionRoot;this.now=now;this.onUpdate=onUpdate;this.visibleThreadIds=new Set();this.currentThreadId=null;this.turnCacheStats=new Map();this.files=new Map();this.headers=new Map();this.discoveredAt=-Infinity;this.lastActivityAt=null;this.running=false;this.timer=null;this.refreshing=null;this.immediateScan=null;this.serialized=null;
 }
 setCurrentThreadId(id){this.currentThreadId=UUID.test(id||'')?id.toLowerCase():null;this.setVisibleThreadIds(this.currentThreadId?[this.currentThreadId]:[]);}
 setVisibleThreadIds(ids){const next=new Set((ids||[]).filter(id=>UUID.test(id||'')).map(id=>id.toLowerCase()).sort());if([...next].join()===[...this.visibleThreadIds].join())return false;this.visibleThreadIds=next;this.discoveredAt=-Infinity;this.requestImmediateScan();return true;}
 taskTokenDetails(id){
  const stats=this.turnCacheStats.get(id);if(!stats?.events.size)return emptyDetails();
  const events=[...stats.events.values()].sort((a,b)=>a.timestamp-b.timestamp||a.order-b.order);
  let previous=null,input=0,cached=0,output=0,inputKnown=true,cachedKnown=true,outputKnown=true;
  for(const e of events){if(e.totalTokens!==null&&e.totalTokens===previous)continue;if(e.totalTokens!==null)previous=e.totalTokens;inputKnown&&=valid(e.inputTokens);cachedKnown&&=valid(e.cachedInputTokens);outputKnown&&=valid(e.outputTokens);input+=e.inputTokens??0;cached+=e.cachedInputTokens??0;output+=e.outputTokens??0;}
  const latest=events.at(-1);return {inputTokens:inputKnown&&valid(input)?input:null,cachedInputTokens:cachedKnown&&valid(cached)?cached:null,uncachedInputTokens:inputKnown&&cachedKnown&&cached<=input&&valid(input-cached)?input-cached:null,outputTokens:outputKnown&&valid(output)?output:null,contextTokens:latest.contextTokens,contextWindow:latest.contextWindow};
 }
 threadUsageView(id){return {currentThreadId:id||null,tokenDetails:this.taskTokenDetails(id),status:this.turnCacheStats.get(id)?.status||'idle'};}
 consume(state,line){
  if(!/"(?:token_count|task_started|task_complete|turn_aborted|turn_context)"/.test(line))return;
  let item;try{item=JSON.parse(line);}catch{return;}
  const p=item.payload||{},timestamp=Date.parse(item.timestamp);
  if(!Number.isFinite(timestamp)||(state.meta.forked&&timestamp<state.meta.timestamp))return;
  const stats=this.turnCacheStats.get(state.meta.id)||{events:new Map(),status:'idle',statusAt:0};
  if(item.type==='turn_context'||(item.type==='event_msg'&&['task_started','task_complete','turn_aborted'].includes(p.type))){
   if(timestamp>=stats.statusAt){stats.status=(item.type==='turn_context'||p.type==='task_started')?'running':'idle';stats.statusAt=timestamp;}
  }
  const event=parseLocalTokenUsageEvent(line);
  if(event&&!stats.events.has(event.identity)){event.order=stats.events.size;stats.events.set(event.identity,event);}
  this.turnCacheStats.set(state.meta.id,stats);
 }
 read(file,state){
  let fd;try{const st=fs.statSync(file);if(st.size<state.offset||st.ino!==state.ino){state.offset=0;state.partial=Buffer.alloc(0);this.turnCacheStats.delete(state.meta.id);state.ino=st.ino;}
   if(st.size===state.offset)return;fd=fs.openSync(file,'r');const end=st.size;
   while(state.offset<end){const b=Buffer.alloc(Math.min(262144,end-state.offset));const length=fs.readSync(fd,b,0,b.length,state.offset);if(!length)break;state.offset+=length;const data=Buffer.concat([state.partial,b.subarray(0,length)]);let start=0;for(let i=0;i<data.length;i++){if(data[i]===10){this.consume(state,data.subarray(start,i).toString('utf8'));start=i+1;}}state.partial=data.subarray(start);}
   this.lastActivityAt=this.now();
  }catch(e){if(!['ENOENT','EACCES','EPERM'].includes(e.code))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 refresh(){
  if(this.refreshing)return this.refreshing;
  this.refreshing=Promise.resolve().then(()=>{
   if(this.now()-this.discoveredAt>=4000){this.discoveredAt=this.now();for(const file of discover(this.sessionRoot)){
    let meta=this.headers.get(file);if(!meta){meta=header(file);if(meta)this.headers.set(file,meta);}if(!meta||!this.visibleThreadIds.has(meta.id))continue;
    if(!this.files.has(file)){const st=fs.statSync(file);this.files.set(file,{meta,offset:0,ino:st.ino,partial:Buffer.alloc(0)});}
   }}
   const rebuild=new Set();
   for(const [file,state] of this.files)if(this.visibleThreadIds.has(state.meta.id)){
    try{const st=fs.statSync(file);if(st.size<state.offset||st.ino!==state.ino)rebuild.add(state.meta.id);}catch(e){if(e.code==='ENOENT'){this.files.delete(file);this.headers.delete(file);rebuild.add(state.meta.id);}}
   }
   for(const id of rebuild){this.turnCacheStats.delete(id);for(const [file,state] of this.files)if(state.meta.id===id){state.offset=0;state.partial=Buffer.alloc(0);try{state.ino=fs.statSync(file).ino;}catch{}}}
   for(const [file,state] of this.files)if(this.visibleThreadIds.has(state.meta.id))this.read(file,state);
   const view={threads:Object.fromEntries([...this.visibleThreadIds].map(id=>[id,this.threadUsageView(id)]))};const serial=JSON.stringify(view);if(serial!==this.serialized){this.serialized=serial;this.onUpdate(view);}return view;
  }).finally(()=>{this.refreshing=null;});return this.refreshing;
 }
 scheduleNextScan(){if(!this.running||this.timer)return;const generating=[...this.visibleThreadIds].some(id=>this.turnCacheStats.get(id)?.status==='running');const delay=localTokenNextScanDelay({now:this.now(),lastActivityAt:this.lastActivityAt,generating});this.timer=setTimeout(()=>{this.timer=null;this.refresh().catch(e=>console.error('[usage-monitor] log scan:',e.message)).finally(()=>this.scheduleNextScan());},delay);this.timer.unref?.();}
 requestImmediateScan(){this.lastActivityAt=this.now();if(this.timer)clearTimeout(this.timer);this.timer=null;if(this.immediateScan)return this.immediateScan;
  this.immediateScan=(async()=>{if(this.refreshing)await this.refreshing.catch(()=>{});return this.refresh();})().finally(()=>{this.immediateScan=null;this.scheduleNextScan();});return this.immediateScan;}
 async start(){this.running=true;await this.refresh();this.scheduleNextScan();}
 async stop(){this.running=false;if(this.timer)clearTimeout(this.timer);this.timer=null;await this.immediateScan?.catch(()=>{});await this.refreshing?.catch(()=>{});}
}
export class SessionUsageClient {
 constructor({onUpdate=()=>{},...options}={}){this.local=new LocalSessionTracker({...options,onUpdate});}
 setVisibleThreadIds(ids){return this.local.setVisibleThreadIds(ids);}
 requestImmediateScan(){return this.local.requestImmediateScan();}
 forThread(_base,id){return this.local.threadUsageView(id);}
 start(){return this.local.start();}
 stop(){return this.local.stop();}
}
