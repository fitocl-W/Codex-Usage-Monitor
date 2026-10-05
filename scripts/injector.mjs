import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionUsageClient} from './usage-client.mjs';
import {createUiSettingsStore,MAX_UI_SETTINGS_BYTES} from './ui-settings.mjs';
import {isMainCodexRendererTarget,syncWindowThread} from './current-thread.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST_ID='codex-usage-monitor',STATE_KEY='__CODEX_USAGE_MONITOR_STATE__',PERSISTED_SETTINGS_KEY='__CODEX_USAGE_MONITOR_PERSISTED_SETTINGS__',SETTINGS_BINDING='__codexUsageMonitorSaveSettings',TARGET_ABSENCE_EXIT_MS=180000;
class CdpSession {
  constructor(target, commandTimeoutMs) {
    this.target = target;
    this.commandTimeoutMs = commandTimeoutMs;
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP WebSocket open timed out after ${this.commandTimeoutMs} ms`)), this.commandTimeoutMs);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", (error) => { clearTimeout(timer); reject(error); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, timeoutMs = this.commandTimeoutMs) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, timeoutMs = this.commandTimeoutMs) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  async close() {
    for (const waiter of this.pending.values()) clearTimeout(waiter.timer);
    this.pending.clear();
    if (this.closed || this.ws.readyState === WebSocket.CLOSED) {
      this.closed = true;
      return;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closed = true;
        resolve();
      };
      const timer = setTimeout(finish, 500);
      this.ws.addEventListener("close", finish, { once: true });
      if (this.ws.readyState !== WebSocket.CLOSING) {
        try { this.ws.close(); } catch { finish(); }
      }
    });
  }
}

function isValidDebuggerSocket(value, port) {
  try {
    const url = new URL(value);
    return url.protocol === "ws:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase())
      && Number(url.port) === port
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

async function getTargets(port) {
  return (await getTargetStatus(port)).targets;
}

async function getTargetStatus(port) {
  for (const host of ["127.0.0.1", "[::1]", "localhost"]) {
    try {
      const response = await fetch(`http://${host}:${port}/json/list`, { redirect: "error", signal: AbortSignal.timeout(1000) });
      if (!response.ok) continue;
      const targets = await response.json();
      if (!Array.isArray(targets)) continue;
      return { reachable: true, targets: targets.filter((item) => item?.type === "page"
        && String(item.url).startsWith("app://")
        && isValidDebuggerSocket(item.webSocketDebuggerUrl, port)) };
    } catch {}
  }
  return { reachable: false, targets: [] };
}

// A responsive desktop can legitimately have no Composer while restoring tasks
// or showing ordinary ChatGPT chat. Only sustained endpoint loss ends the watch.
export function nextEndpointLoss(previous, reachable, now, graceMs = TARGET_ABSENCE_EXIT_MS) {
  const missingSince = reachable ? null : previous ?? now;
  return { missingSince, shouldExit: missingSince !== null && now - missingSince >= graceMs };
}

export function backendHeartbeatExpression(pid, now = Date.now()) {
  return `(() => {
    const entries = window.__CODEX_USAGE_MONITOR_BACKENDS__ ||= {};
    for (const [key, value] of Object.entries(entries)) if (!value || ${now} - value.at > 60000) delete entries[key];
    const value = { pid: ${pid}, at: ${now}, phase: document.getElementById(${JSON.stringify(HOST_ID)}) ? "connected" : "waiting-composer" };
    entries[${JSON.stringify(String(pid))}] = value;
    window.__CODEX_USAGE_MONITOR_BACKEND__ = value;
    return value;
  })()`;
}

export function backendVerificationExpression(expectedPid = null, now = Date.now()) {
  return `(() => {
    const expectedPid = ${JSON.stringify(expectedPid)};
    const value = expectedPid === null ? window.__CODEX_USAGE_MONITOR_BACKEND__ : window.__CODEX_USAGE_MONITOR_BACKENDS__?.[String(expectedPid)];
    const age = typeof value?.at === "number" ? ${now} - value.at : null;
    return { backendRunning: Boolean(value && Number.isSafeInteger(value.pid) && value.pid > 0 && (expectedPid === null || value.pid === expectedPid) && age !== null && age >= 0 && age <= 15000 && ["connected", "waiting-composer"].includes(value.phase)),
      pid: value?.pid || null, phase: value?.phase || null, heartbeatAgeMs: age,
      installed: Boolean(document.getElementById(${JSON.stringify(HOST_ID)})?.shadowRoot) };
  })()`;
}

async function waitForTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getTargets(port);
    if (targets.length) return targets;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No Codex renderer target on local port ${port} within ${timeoutMs} ms.`);
}

const assets=['usage-constants.js','usage-fonts.js','usage-placement.js','usage-compact.js','usage-inject.js'];
export function settingsUpdateExpression(value){return `(()=>window[${JSON.stringify(STATE_KEY)}]?.updateSettings?.(${JSON.stringify(value)})||false)()`;}
async function applyMonitor(session,settings){await session.evaluate(`window[${JSON.stringify(PERSISTED_SETTINGS_KEY)}]=${JSON.stringify(settings)}`);const payload=(await Promise.all(assets.map(name=>fs.readFile(path.join(root,'assets',name),'utf8')))).join('\n');return session.evaluate(payload);}
function optionsFrom(argv){const o={port:9335,mode:'watch',timeoutMs:30000,expectedPid:null};for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--port')o.port=Number(argv[++i]);else if(a==='--timeout-ms')o.timeoutMs=Number(argv[++i]);else if(a==='--expected-pid')o.expectedPid=Number(argv[++i]);else if(['--once','--verify','--remove','--watch'].includes(a))o.mode=a.slice(2);else if(a!=='--monitor-only')throw Error('Unknown argument: '+a);}if(!Number.isInteger(o.port)||o.port<1024||o.port>65535)throw Error('Invalid CDP port');if(!Number.isInteger(o.timeoutMs)||o.timeoutMs<250||o.timeoutMs>120000)throw Error('Invalid timeout');return o;}
async function watch(options){
 const settings=await createUiSettingsStore(),sessions=new Map();let stopped=false,missingSince=null;
 const client=new SessionUsageClient({onUpdate:()=>publish()});
 function publish(){for(const e of sessions.values()){e.dirty=true;if(e.updating)continue;e.updating=(async()=>{while(e.dirty&&!e.session.closed&&!stopped){e.dirty=false;try{await e.session.evaluate(`window[${JSON.stringify(STATE_KEY)}]?.updateUsage?.(${JSON.stringify(client.forThread(null,e.threadId))})`);}catch(error){console.error('[usage-monitor] update:',error.message);}}})().finally(()=>e.updating=null);}}
 async function sync(entry){await syncWindowThread(entry,client,sessions);publish();}
 async function attach(target){if(sessions.has(target.id)&&!sessions.get(target.id).session.closed)return;const session=new CdpSession(target,10000);await session.open();const entry={session,threadId:null,updating:null};sessions.set(target.id,entry);
  session.on('Runtime.bindingCalled',({name,payload})=>{
   if(name===SETTINGS_BINDING&&typeof payload==='string'&&Buffer.byteLength(payload)<=MAX_UI_SETTINGS_BYTES){let value;try{value=JSON.parse(payload);}catch{return;}settings.save(value).then(()=>Promise.allSettled([...sessions.values()].filter(e=>!e.session.closed).map(e=>e.session.evaluate(settingsUpdateExpression(settings.current))))).catch(e=>console.error('[usage-monitor] theme:',e.message));}
   if(name==='__codexUsageMonitorRefreshNow'&&['send','switch'].includes(payload)){if(Date.now()-(entry.hintAt||0)<150)return;entry.hintAt=Date.now();sync(entry).then(()=>client.requestImmediateScan()).then(publish).catch(e=>console.error('[usage-monitor] refresh:',e.message));}
  });
  await session.send('Runtime.addBinding',{name:SETTINGS_BINDING});await session.send('Runtime.addBinding',{name:'__codexUsageMonitorRefreshNow'});
  session.on('Page.loadEventFired',()=>applyMonitor(session,settings.current).then(()=>sync(entry)).catch(e=>console.error('[usage-monitor] reload:',e.message)));
  await applyMonitor(session,settings.current);await sync(entry);
 }
 const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 await client.start();
 try{while(!stopped){const {targets,reachable}=await getTargetStatus(options.port);const loss=nextEndpointLoss(missingSince,reachable,Date.now());missingSince=loss.missingSince;if(loss.shouldExit)break;
  const selected=targets.filter(isMainCodexRendererTarget),ids=new Set(selected.map(t=>t.id));for(const [id,e] of sessions)if(!ids.has(id)||e.session.closed){await e.session.close().catch(()=>{});sessions.delete(id);}client.setVisibleThreadIds([...sessions.values()].map(e=>e.threadId).filter(Boolean));
  for(const target of selected)try{await attach(target);}catch(e){const entry=sessions.get(target.id);if(entry){await entry.session.close().catch(()=>{});sessions.delete(target.id);}console.error('[usage-monitor] attach:',e.message);}
  for(const entry of sessions.values())try{await entry.session.evaluate(backendHeartbeatExpression(process.pid));await sync(entry);}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }}finally{stopped=true;await client.stop();await settings.flush();for(const e of sessions.values())await e.session.close().catch(()=>{});process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
export async function runOnce(options){const targets=(await waitForTargets(options.port,options.timeoutMs)).filter(isMainCodexRendererTarget);let ok=false;for(const target of targets){const session=new CdpSession(target,options.timeoutMs);try{await session.open();if(options.mode==='remove'){await session.evaluate(`window[${JSON.stringify(STATE_KEY)}]?.cleanup?.()`);ok=true;}else if(options.mode==='verify'){const status=await session.evaluate(backendVerificationExpression(options.expectedPid));ok ||= status.backendRunning===true;console.log(JSON.stringify(status));}else{const store=await createUiSettingsStore();ok ||= (await applyMonitor(session,store.current))?.installed===true;}}finally{await session.close();}}if(!ok)throw Error('No active monitor runtime found');}
async function main(){const options=optionsFrom(process.argv.slice(2));if(options.mode==='watch')await watch(options);else await runOnce(options);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('[usage-monitor]',e.message);process.exitCode=1;});
