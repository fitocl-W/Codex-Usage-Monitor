(() => {
 const modules=window.__CODEX_USAGE_MONITOR_MODULES__,{STATE_KEY,USAGE_KEY,HOST_ID,SETTINGS_KEY,PERSISTED_SETTINGS_KEY,SETTINGS_BINDING}=modules.constants;
 const previous=window[STATE_KEY]?.usage??window[USAGE_KEY]??{};
 window[STATE_KEY]?.cleanup?.();
 // Old cleanup removes the registry; this injection owns these module references.
 window.__CODEX_USAGE_MONITOR_MODULES__=modules;
 const {findPlacement,clearPlacement}=modules.placement;
 let preferred=null,timer=null,pending=null,sendTimer=null,signature=null,closed=false;
 let previewSettings=null,closeTimer=null,pointer=null,keyboardMode=false;
 const normalize=value=>({schemaVersion:2,theme:modules.constants.THEMES.includes(value?.theme)?value.theme:'white',layout:modules.constants.LAYOUTS.includes(value?.layout)?value.layout:'default'});
 let settings=window[PERSISTED_SETTINGS_KEY];
 if(!settings)try{settings=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');}catch{}
 settings=normalize(settings);
 const remember=()=>{window[PERSISTED_SETTINGS_KEY]=settings;try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch{}};
 const cancelClose=()=>{if(closeTimer){clearTimeout(closeTimer);closeTimer=null;}};
 const show=(host,open)=>{cancelClose();host.dataset.open=String(open);host.shadowRoot.querySelector('.usage-summary').setAttribute('aria-expanded',String(open));host.shadowRoot.querySelector('.usage-popover').hidden=!open;if(!open)modules.appearance?.close?.(host);else modules.appearance?.fit?.(host);};
 const within=(node,x,y)=>{if(!node||node.hidden)return false;const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
 const pointerInside=host=>pointer&&(modules.appearance?.containsPoint?.(host,pointer.x,pointer.y)??[host.shadowRoot.querySelector('.usage-summary'),host.shadowRoot.querySelector('.usage-popover'),host.shadowRoot.querySelector('.compact-hover-bridge')].some(n=>within(n,pointer.x,pointer.y)));
 const scheduleClose=host=>{if(closeTimer||host.dataset.open!=='true')return;closeTimer=setTimeout(()=>{closeTimer=null;if(host.hidden)return;if(pointerInside(host)||(!pointer&&host.matches(':hover'))||(keyboardMode&&host.shadowRoot.activeElement))return;show(host,false);},100);};
 const rememberPointer=e=>{if(Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))pointer={x:e.clientX,y:e.clientY};};
 const pointerMove=e=>{keyboardMode=false;rememberPointer(e);const host=document.getElementById(HOST_ID);if(host?.dataset.open==='true'){if(pointerInside(host))cancelClose();else scheduleClose(host);}};
 const pointerOut=e=>{if(!e.relatedTarget){pointer=null;keyboardMode=false;const host=document.getElementById(HOST_ID);if(host)scheduleClose(host);}};
 const render=host=>modules.compact.render(host,window[STATE_KEY]?.usage||{});
 function ensure(){
  if(closed)return null;const state=window[STATE_KEY],placement=findPlacement(HOST_ID,preferred);
  if(!placement.composer){const host=document.getElementById(HOST_ID);if(host){host.hidden=true;show(host,false);}clearPlacement();state.health={ok:false,reason:placement.reason};return host;}
  preferred=placement.composer;let host=document.getElementById(HOST_ID);
  if(!host?.shadowRoot){host?.remove();host=document.createElement('span');host.id=HOST_ID;host.dataset.open='false';
   host.attachShadow({mode:'open'}).innerHTML='<style>:host{position:fixed;left:var(--usage-left,0px);top:var(--usage-top,0px);display:inline-flex;color:#717782;font:12px/1.5 system-ui;pointer-events:auto}:host([hidden]),[hidden]{display:none!important}</style><div class="usage-summary" role="button" tabindex="0" aria-expanded="false"></div><div class="usage-popover" role="region" hidden></div>';
   const summary=host.shadowRoot.querySelector('.usage-summary');
   host.addEventListener('pointerenter',e=>{rememberPointer(e);show(host,true);});host.addEventListener('pointerleave',e=>{rememberPointer(e);if(host.contains(e.relatedTarget)||host.shadowRoot.contains(e.relatedTarget)||pointerInside(host))cancelClose();else scheduleClose(host);});
   host.addEventListener('focusin',()=>{if(!pointerInside(host))keyboardMode=true;show(host,true);});host.addEventListener('focusout',e=>{if(!host.contains(e.relatedTarget)&&!host.shadowRoot.contains(e.relatedTarget)&&!pointerInside(host))scheduleClose(host);});
   summary.addEventListener('keydown',e=>{if(e.key==='Escape'){show(host,false);e.preventDefault();}else if(['Enter',' '].includes(e.key)){show(host,true);e.preventDefault();}});
  }
  if(host.parentNode!==document.body)document.body.append(host);
  state.host=host;state.health=modules.compact.configurePosition(host,placement.composer);render(host);return host;
 }
 const hint=reason=>{try{window.__codexUsageMonitorRefreshNow?.(reason);}catch{}};
 const checkSwitch=()=>{const next=[...document.querySelectorAll('[data-above-composer-conversation-id],[data-conversation-id],[data-thread-id]')].filter(n=>!n.closest('[inert],[aria-hidden="true"],[data-app-shell-active-page="false"]')).map(n=>['data-above-composer-conversation-id','data-conversation-id','data-thread-id'].map(a=>n.getAttribute(a)||'').join(':')).join('|');
  if(next!==signature){if(signature!==null){const host=document.getElementById(HOST_ID);if(host)host.__compactMessageSent=false;hint('switch');}signature=next;}};
 const queueLayout=()=>{checkSwitch();if(pending)clearTimeout(pending);pending=setTimeout(()=>{pending=null;ensure();if(!window[STATE_KEY]?.health.ok){clearTimeout(timer);schedule();}},120);};
 const observer=new MutationObserver(queueLayout);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','aria-label','title','aria-valuenow','aria-valuemax','stroke-dasharray','placeholder','data-placeholder','data-above-composer-conversation-id','data-conversation-id','data-thread-id']});
 function schedule(){if(closed)return;timer=setTimeout(()=>{if(!document.hidden)ensure();schedule();},window[STATE_KEY]?.health.ok?20000:250);}
 const send=()=>{const host=document.getElementById(HOST_ID);if(host)host.__compactMessageSent=true;if(sendTimer)clearTimeout(sendTimer);sendTimer=setTimeout(()=>{sendTimer=null;hint('send');},0);};
 const key=e=>{const focused=document.getElementById(HOST_ID);if(focused&&e.composedPath().includes(focused))keyboardMode=true;if(e.key==='Escape'){const host=document.getElementById(HOST_ID),menu=host?.shadowRoot?.querySelector('.theme-menu');if(menu&&!menu.hidden){e.preventDefault();e.stopPropagation();modules.appearance.close(host);return;}}if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!e.defaultPrevented&&findPlacement(HOST_ID).composer?.contains(e.target)&&e.target.closest?.('textarea,[contenteditable="true"]'))send();};
 const click=e=>{const b=e.target.closest?.('button,[role="button"]');if(b&&!b.disabled&&findPlacement(HOST_ID).composer?.contains(b)&&/发送|提交|\bsend\b|\bsubmit\b/i.test([b.getAttribute('aria-label'),b.title,b.getAttribute('data-testid')].join(' ')))send();};
 const submit=e=>{if(findPlacement(HOST_ID).composer?.contains(e.target))send();};
 const outside=e=>{const host=document.getElementById(HOST_ID);if(host&&!e.composedPath().includes(host))show(host,false);};
 const visibility=()=>{if(!document.hidden){ensure();hint('switch');}};
 document.addEventListener('pointermove',pointerMove,true);document.addEventListener('pointerout',pointerOut);window.addEventListener('resize',queueLayout);window.addEventListener('pointerdown',outside,true);document.addEventListener('visibilitychange',visibility);document.addEventListener('keydown',key);document.addEventListener('click',click);document.addEventListener('submit',submit);
 window[STATE_KEY]={usage:previous,host:null,health:{ok:false,reason:'initializing'},ensure,getSettings:()=>({...settings}),diagnose(){return {...this.health};},setTheme(theme){return this.setAppearance({...settings,theme});},setLayout(layout){return this.setAppearance({...settings,layout});},setAppearance(value){settings=normalize(value);previewSettings=null;remember();try{window[SETTINGS_BINDING]?.(JSON.stringify(settings));}catch{}const host=ensure();if(host)render(host);return true;},getDisplaySettings:()=>({...previewSettings||settings}),previewAppearance(value){previewSettings=normalize(value);ensure();return true;},clearPreview(){if(!previewSettings)return true;previewSettings=null;ensure();return true;},updateSettings(value){if(!value||typeof value!=='object'||Array.isArray(value))return false;settings=normalize(value);remember();const host=ensure();if(host)render(host);return true;},updateUsage(value){this.usage={currentThreadId:value?.currentThreadId||null,tokenDetails:value?.tokenDetails??null,status:value?.status||'idle'};window[USAGE_KEY]=this.usage;ensure();return true;},cleanup(){closed=true;cancelClose();document.removeEventListener('pointermove',pointerMove,true);document.removeEventListener('pointerout',pointerOut);observer.disconnect();clearTimeout(timer);clearTimeout(pending);clearTimeout(sendTimer);window.removeEventListener('resize',queueLayout);window.removeEventListener('pointerdown',outside,true);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',key);document.removeEventListener('click',click);document.removeEventListener('submit',submit);document.getElementById(HOST_ID)?.remove();clearPlacement();delete window[STATE_KEY];delete window[USAGE_KEY];return true;}};
 remember();checkSwitch();const host=ensure();schedule();return {installed:Boolean(host),mode:'local-session'};
})();
