(() => {
  const registry = window.__CODEX_USAGE_MONITOR_MODULES__ ||= {};
  registry.compact?.restoreNative();
  const valid = (n) => Number.isSafeInteger(n) && n >= 0;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const hiddenNative = new Map();
  const restoreNative = (keep = null) => {
    for (const [node, saved] of hiddenNative) {
      if (node === keep) continue;
      for (const [property, value, priority] of saved) {
        if (value) node.style.setProperty(property, value, priority);
        else node.style.removeProperty(property);
      }
      hiddenNative.delete(node);
    }
  };
  const hideNative = (control) => {
    // Keep the native element mounted and measurable, so React and context
    // metadata still work. Hide only a small trigger, never the model picker.
    const button = control.closest('button,[role="button"]');
    const node = button && button.getBoundingClientRect().width <= 64 ? button : control;
    restoreNative(node);
    if (!hiddenNative.has(node)) hiddenNative.set(node, ['visibility','pointer-events'].map(property =>
      [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]));
    if (node.style.getPropertyValue('visibility') !== 'hidden' || node.style.getPropertyPriority('visibility') !== 'important') node.style.setProperty('visibility','hidden','important');
    if (node.style.getPropertyValue('pointer-events') !== 'none' || node.style.getPropertyPriority('pointer-events') !== 'important') node.style.setProperty('pointer-events','none','important');
  };
  const text = (node) => [node?.getAttribute('aria-label'), node?.getAttribute('title'), node?.getAttribute('data-testid'), node?.textContent].filter(Boolean).join(' ');
  const isUnsentNewSession = (host) => {
    if (host.__compactMessageSent) return false;
    const active = node => !node.closest('[inert],[aria-hidden="true"],[data-app-shell-active-page="false"]');
    const details=window[registry.constants.STATE_KEY]?.usage?.tokenDetails;
    if(details&&['inputTokens','cachedInputTokens','uncachedInputTokens','outputTokens','contextTokens'].some(key=>valid(details[key])&&details[key]>0))return false;
    // A thread ID can be allocated before the first message. Use actual
    // message/usage evidence rather than rejecting every allocated ID.
    const messages=[...document.querySelectorAll('[data-message-id],[data-turn-id],[data-message-author-role],[data-testid="user-message"],[data-testid="assistant-message"]')];
    if(messages.some(node=>active(node)&&(node.textContent||'').trim()))return false;
    return [...document.querySelectorAll('button,[role="button"]')].some(node=>{
      const r=node.getBoundingClientRect();
      return active(node)&&r.width>0&&r.height>0&&/选择项目|select project|choose project/i.test(text(node));
    });
  };
  const findModelControl = (composer) => [...composer.querySelectorAll('button,[role="button"]')]
    .filter(node => {
      const r=node.getBoundingClientRect();
      if(r.width<=0 || r.height<=0 || r.height>48 || node.closest('[inert],[data-app-shell-active-page="false"]'))return false;
      const label=text(node);
      return /(?:选择模型|切换模型|模型选择|select model|choose model|model selector|model-picker)/i.test(label)
        || /\b(?:GPT[-\s]?\d|o[134](?:\b|[-\s])|codex[-\s]|claude[-\s]|gemini[-\s]|deepseek[-\s])/i.test(label);
    }).sort((a,b)=>b.getBoundingClientRect().top-a.getBoundingClientRect().top)[0] || null;
  let fontMeasureContext;
  const visibleTextCenter = (node, rect, bottom = false, reference = null) => {
    if (typeof window.CanvasRenderingContext2D === 'function') {
      try {
        fontMeasureContext ||= document.createElement('canvas').getContext('2d');
        const style=getComputedStyle(node.parentElement);
        fontMeasureContext.font=style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics=fontMeasureContext.measureText(reference??node.textContent.trim());
        const fontHeight=metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent;
        if(fontHeight>0 && Number.isFinite(metrics.actualBoundingBoxAscent) && Number.isFinite(metrics.actualBoundingBoxDescent)) {
          const baseline=rect.top+metrics.fontBoundingBoxAscent*rect.height/fontHeight;
          if(bottom)return baseline+metrics.actualBoundingBoxDescent*rect.height/fontHeight;
          return baseline+(metrics.actualBoundingBoxDescent-metrics.actualBoundingBoxAscent)*rect.height/fontHeight/2;
        }
      } catch {}
    }
    return rect.top+rect.height/(bottom?1:2);
  };
  const modelTextCenter = (model, bottom = false) => {
    const walker=document.createTreeWalker(model,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      if(!/\b(?:GPT[-\s]?\d|o[134](?:\b|[-\s])|codex[-\s]|claude[-\s]|gemini[-\s]|deepseek[-\s])/i.test(node.textContent||''))continue;
      const range=document.createRange();range.selectNodeContents(node);
      const rect=range.getBoundingClientRect?.();
      if(rect && rect.height>0)return visibleTextCenter(node,rect,bottom);
    }
    const rect=model.getBoundingClientRect();return rect.top+rect.height/(bottom?1:2);
  };
  const findContextControl = (composer) => {
    const visible = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[inert], [data-app-shell-active-page="false"]'); };
    const semantic = [...composer.querySelectorAll('[aria-label], [title], [data-testid], [role="progressbar"]')]
      .filter(n => visible(n) && /context|上下文|背景信息窗口/i.test(text(n)) && n.getBoundingClientRect().height <= 48);
    if (semantic.length) return semantic.sort((a,b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    // A progress ring can have no label until its tooltip opens. Require a
    // measured stroke, rather than mistaking a loading spinner for context.
    return [...composer.querySelectorAll('svg')].filter(visible).find(svg => {
      const r = svg.getBoundingClientRect();
      if (svg.closest('[aria-busy="true"]') || /spin|spinner|loading/i.test(svg.getAttribute('class') || '')) return false;
      if (getComputedStyle(svg).animationName && getComputedStyle(svg).animationName !== 'none') return false;
      return r.width <= 36 && r.height <= 36 && [...svg.querySelectorAll('circle')].some(c => {
        const s = getComputedStyle(c);
        if (s.animationName && s.animationName !== 'none') return false;
        return c.hasAttribute('stroke-dasharray') || (s.strokeDasharray && s.strokeDasharray !== 'none');
      });
    }) || null;
  };
  const css = `
    :host { --compact-bg:#fff;--compact-border:#e5e8f0;--compact-ink:#202329;--compact-muted:#878d99;--compact-heading:#858b96;--compact-note:#9a9faa;--compact-divider:#edf0f7;--compact-track:#ededf0;--compact-fill:#508bff;--compact-shadow:0 8px 30px #19243b14;--compact-light:transparent;--compact-dot:#6d82a2; }
    :host([data-theme="glass"]) { --compact-bg:rgba(255,250,247,.58);--compact-border:rgba(169,130,111,.42);--compact-ink:#363137;--compact-muted:#82737a;--compact-heading:#82737a;--compact-note:#82737a;--compact-divider:#ffffffa6;--compact-track:#e5d8d54f;--compact-fill:linear-gradient(90deg,#c79276,#d8a37e 54%,#b8a2bb);--compact-shadow:0 15px 36px #6d473718,0 3px 9px #5d51400a,inset 0 1px 0 #f5e7dd70;--compact-light:radial-gradient(ellipse at 0% 0%,#d89e76a8 0%,#eac3a980 32%,#f0d8c75c 62%,transparent 100%),radial-gradient(ellipse at 100% 100%,#c9b6d166 0%,#e2d0df38 55%,transparent 95%),linear-gradient(135deg,#f0c5a957 0%,#f3d9c94d 48%,#e6d5df38 100%);--compact-dot:#b78e77; }
    :host([data-layout="compact"]) { width:66px!important; min-width:66px!important; max-width:66px!important; justify-content:flex-end; z-index:1000; }
    :host([data-layout="compact"]) .usage-summary { width:max-content!important;max-width:100%;box-sizing:border-box;display:flex!important;align-items:center;justify-content:center; }
    :host([data-layout="compact"]) .usage-summary { padding:1.2px 2.4px!important; height:18.4px!important; min-height:0!important; border:0!important; border-radius:4px!important; background:transparent!important; font:500 12px/16px system-ui!important; white-space:nowrap; box-shadow:none!important; cursor:pointer; }
    :host([data-layout="compact"]) .usage-summary:hover { background:transparent!important; }
    .compact-summary-content { position:relative;display:inline-flex;align-items:center;isolation:isolate; }
    :host([data-layout="compact"]) .usage-summary:is(:hover,:focus-visible,[aria-expanded="true"]) .compact-summary-content::before { content:"";position:absolute;inset:-4px -7px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent);pointer-events:none;z-index:-1; }
    .compact-context-ring { width:16px;height:16px;flex:none;transform:rotate(-90deg); }
    :host([data-theme="glass"]) .compact-context-ring { color:#b1846c; }
    :host([data-theme="glass"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-layout="compact"]) .usage-popover { overflow:visible!important;max-height:none!important;scrollbar-gutter:auto!important; }
    .compact-content { max-height:min(440px,calc(100vh - 90px));overflow-y:auto; }
    .compact-hover-bridge { position:absolute;bottom:100%;right:0;width:284px;max-width:calc(100vw - 24px);height:12px;transform:translateX(var(--compact-shift,0px));background:transparent;pointer-events:auto;display:none; }
    :host([data-open="true"]) .compact-hover-bridge { display:block; }
    .compact-ring-track { fill:none;stroke:currentColor;stroke-opacity:.18;stroke-width:2.5; }
    .compact-ring-value { fill:none;stroke:currentColor;stroke-opacity:.65;stroke-width:2.5;stroke-linecap:round; }
    .compact-summary-value { margin-left:3px;font-variant-numeric:tabular-nums; }
    :host([data-layout="compact"]) .usage-popover { position:absolute!important; width:284px!important; min-width:0!important; max-width:calc(100vw - 24px)!important; padding:15px!important; box-sizing:border-box; top:auto!important; bottom:calc(100% + 10px)!important; left:auto!important; right:0!important; transform:translateX(var(--compact-shift,0px))!important; border:1px solid var(--compact-border)!important; border-radius:14px!important; background:var(--compact-bg)!important; color:var(--compact-ink)!important; box-shadow:var(--compact-shadow)!important; font:12px/1.5 system-ui!important; isolation:isolate; }
    .usage-popover::before { content:"";position:absolute;inset:0;border-radius:inherit;background:var(--compact-light);pointer-events:none;z-index:-1; }
    :host([data-theme="glass"]) .usage-popover { backdrop-filter:saturate(135%) blur(23px);-webkit-backdrop-filter:saturate(135%) blur(23px); }
    .compact-context { display:flex;justify-content:space-between;gap:8px;align-items:center; }
    .compact-muted { color:var(--compact-muted); }
    .compact-track { height:4px;background:var(--compact-track);border-radius:4px;margin:9px 0 15px;overflow:hidden; }
    .compact-fill { height:100%;width:0;background:var(--compact-fill);border-radius:4px; }
    .compact-heading { border-top:1px solid var(--compact-divider);padding-top:12px;margin-bottom:8px;color:var(--compact-heading);font-weight:650; }
    .compact-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px 12px; }
    .compact-value { font-size:14px;color:var(--compact-ink);font-variant-numeric:tabular-nums;white-space:nowrap; }
    .compact-footer { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px; }
    .compact-note { font-size:10px;color:var(--compact-note); }
    .compact-theme-toggle { display:grid;place-items:center;flex:none;width:24px;height:24px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer; }
    .compact-theme-toggle::before { content:"";width:10px;height:10px;border-radius:50%;background:var(--compact-dot); }
    .compact-theme-toggle:hover::before { box-shadow:0 0 0 4px color-mix(in srgb,var(--compact-dot) 12%,transparent); }
    .compact-theme-toggle:focus-visible { outline:2px solid var(--compact-dot);outline-offset:1px; }
    @media(prefers-color-scheme:dark) { :host([data-theme="glass"]) { --compact-bg:rgba(255,250,247,.84); } }
    @supports not (backdrop-filter:blur(1px)) { :host([data-theme="glass"]) { --compact-bg:#f8f0eb; } }

    :host { --compact-font:"MonitorSans",sans-serif;--compact-entry:#717782; }
    :host([data-theme="glass"]) { --compact-font:"MonitorLora","MonitorSans",serif;--compact-ink:#684637;--compact-muted:#947363;--compact-heading:#795744;--compact-note:#947363;--compact-entry:#ae795b; }
    :host([data-theme="olive"]) { --compact-font:"MonitorBarlow","MonitorSans",sans-serif;--compact-bg:#10130b;--compact-ink:#e4efc8;--compact-muted:#adb79b;--compact-heading:#cfdaa9;--compact-note:#a5ad94;--compact-border:#58603d88;--compact-divider:#c4d09b22;--compact-track:#444c2f;--compact-fill:linear-gradient(90deg,#879743,#dff87d);--compact-dot:#dff87d;--compact-entry:#809444;--compact-shadow:0 14px 30px #11180922,inset 0 1px 0 #d4e49b10;--compact-light:radial-gradient(ellipse at 20% 25%,#8593284c,transparent 68%),radial-gradient(ellipse at 93% 5%,#d1df7812,transparent 47%); }
    :host([data-theme="sketch"]) { --compact-font:"MonitorCaveat","MonitorWenkai",cursive;--compact-bg:#fffefb;--compact-ink:#505b58;--compact-muted:#787a6f;--compact-heading:#62695e;--compact-note:#858575;--compact-border:#dedbd2;--compact-divider:#b8b8ac66;--compact-track:#eef0e7;--compact-fill:repeating-linear-gradient(125deg,#94bdb4 0 1px,#d7e7dd 1px 4px);--compact-dot:#cb927e;--compact-entry:#639b91;--compact-shadow:0 2px 4px #49433608,0 12px 30px #4943360d;--compact-light:radial-gradient(ellipse at 95% 0%,#f8dad526,transparent 65%); }
    :host([data-theme="trail"]) { --compact-font:"MonitorLora","MonitorWenkai",serif;--compact-bg:#f7f6ed;--compact-ink:#435c35;--compact-muted:#718064;--compact-heading:#526b43;--compact-note:#849075;--compact-border:#b7c3a684;--compact-divider:#acb89b48;--compact-track:#dce3ce;--compact-fill:linear-gradient(90deg,#55724a,#87a16b 64%,#d5b96d);--compact-dot:#71895c;--compact-entry:#67814f;--compact-shadow:0 12px 27px #46542e0d,inset 0 1px 0 #ffffffa0;--compact-light:radial-gradient(circle at 90% 8%,#f2cf805c,#e9d7a532 22%,transparent 46%),radial-gradient(ellipse at 0% 100%,#d1debb70,transparent 72%),linear-gradient(140deg,#fff8ec40,#e9efdd5c); }
    :host([data-layout="compact"]) .usage-summary { font-family:var(--compact-font)!important;color:var(--compact-entry);font-weight:400!important; }
    :host([data-layout="compact"]) .usage-popover { font-family:var(--compact-font)!important; }
    :host([data-theme="glass"]) .compact-context-ring { color:var(--compact-entry); }
    :host([data-theme="olive"]) .compact-ring-value,:host([data-theme="sketch"]) .compact-ring-value,:host([data-theme="trail"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-theme="olive"]) [data-value="0"] { color:#dff87d; }
    :host([data-theme="olive"]) .compact-value { font-weight:500; }
    :host([data-theme="sketch"]) .compact-value { font-size:16px;line-height:1.4;letter-spacing:-.2px; }
    :host([data-theme="sketch"]) .compact-muted,:host([data-theme="sketch"]) .compact-heading { font-size:14px;font-weight:400; }
    :host([data-theme="sketch"]) .compact-note { font-size:11px; }
    :host([data-theme="sketch"]) [data-value="0"] { color:#699b90; }
    :host([data-theme="sketch"]) [data-value="1"] { color:#b17b67; }
    :host([data-theme="sketch"]) [data-value="2"] { color:#7096a4; }
    :host([data-theme="sketch"]) [data-value="3"] { color:#8a8c66; }
    :host([data-theme="sketch"][data-layout="compact"]) .usage-popover { border-radius:12px!important; }
    :host([data-theme="sketch"]) .compact-track { border:1px solid #aab8a480;height:5px;transform:rotate(-.3deg); }
    :host([data-theme="trail"]) .compact-muted,:host([data-theme="trail"]) .compact-heading { font-size:13px;font-weight:400; }

    /* Shared geometry: fonts and palettes never change the outer dimensions. */
    :host([data-layout="compact"]) { height:20px!important;min-height:20px!important;max-height:20px!important; }
    :host([data-layout="compact"]) .usage-summary { width:66px!important;min-width:66px!important;max-width:66px!important;height:20px!important;justify-content:flex-end!important;font:400 12px/16px "MonitorSans",sans-serif!important; }
    .compact-summary-value { display:inline-block;flex:none;width:auto;text-align:left;line-height:16px; }
    :host([data-layout="compact"]) .usage-popover { height:min(268px,calc(100vh - 90px))!important; }
    .compact-content { box-sizing:border-box;height:100%;max-height:100%;display:grid;grid-template-rows:20px 4px 32px 104px 28px;row-gap:12px;overflow:auto; }
    .compact-context { height:20px;line-height:20px;white-space:nowrap; }
    .compact-track { box-sizing:border-box;height:4px!important;margin:0;transform:none!important; }
    .compact-heading { box-sizing:border-box;height:32px;line-height:18px;padding-top:12px;margin:0; }
    .compact-grid { height:104px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:46px 46px;gap:12px; }
    .compact-grid>div { min-width:0;display:grid;grid-template-rows:18px 24px;row-gap:4px; }
    .compact-grid .compact-muted { height:18px;line-height:18px; }
    .compact-value { height:24px;line-height:24px!important; }
    .compact-footer { height:28px;margin:0; }
    .compact-note { line-height:12px; }

    /* Additional themes share the existing fixed panel geometry. */
    :host([data-theme="graphite"]) { --compact-note:var(--compact-muted);--compact-bg:#fff;--compact-ink:#232527;--compact-muted:#84888b;--compact-heading:#4c5053;--compact-border:#dadddf;--compact-divider:#e8eaeb;--compact-track:#e4e6e7;--compact-fill:repeating-linear-gradient(125deg,#343638 0 2px,#54575a 2px 3px);--compact-dot:#373a3c;--compact-entry:#555b5f;--compact-shadow:0 2px 4px #14181905;--compact-font:"MonitorBarlow"; }
    :host([data-theme="graphite"][data-layout="compact"]) .usage-popover { border-radius:9px!important; }
    :host([data-theme="graphite"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-theme="graphite"]) .compact-grid>div { box-sizing:border-box;padding:3px 5px;grid-template-rows:14px 20px;row-gap:1px; }
    :host([data-theme="graphite"]) .compact-grid .compact-muted { height:14px;line-height:14px;font-size:10px; }
    :host([data-theme="graphite"]) .compact-value { height:20px;line-height:20px!important;font-size:12px;letter-spacing:-.2px; }
    :host([data-theme="mist"]) { --compact-note:var(--compact-muted);--compact-bg:#f7faf8b8;--compact-ink:#344a3f;--compact-muted:#809286;--compact-heading:#53735f;--compact-border:#ffffffb8;--compact-divider:#a7b6ab40;--compact-track:#d3ded6;--compact-fill:linear-gradient(90deg,#768e79,#afbfab);--compact-dot:#859b82;--compact-entry:#64816e;--compact-shadow:0 9px 24px #4e675912,inset 0 1px 0 #fff;--compact-light:radial-gradient(ellipse at 0% 0%,#ffffffc0,transparent 65%),radial-gradient(ellipse at 95% 35%,#b0bea24a,transparent 70%); }
    :host([data-theme="mist"][data-layout="compact"]) .usage-popover { border-radius:22px!important; }
    :host([data-theme="mist"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-theme="mist"]) .compact-grid>div { box-sizing:border-box;padding:3px 5px;grid-template-rows:14px 20px;row-gap:1px; }
    :host([data-theme="mist"]) .compact-grid .compact-muted { height:14px;line-height:14px;font-size:10px; }
    :host([data-theme="mist"]) .compact-value { height:20px;line-height:20px!important;font-size:12px;letter-spacing:-.2px; }
    :host([data-theme="chalk"]) { --compact-note:var(--compact-muted);--compact-bg:#faf9f6;--compact-ink:#2c2e2a;--compact-muted:#94958a;--compact-heading:#55594e;--compact-border:#dddfd6;--compact-divider:#e6e5de;--compact-track:#e4e5df;--compact-fill:#3d4038;--compact-dot:#808276;--compact-entry:#73786b;--compact-shadow:0 2px 3px #55594005;--compact-light:linear-gradient(135deg,#ffffff80,transparent); }
    :host([data-theme="chalk"][data-layout="compact"]) .usage-popover { border-radius:24px!important; }
    :host([data-theme="chalk"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-theme="chalk"]) .compact-grid>div { box-sizing:border-box;padding:3px 5px;grid-template-rows:14px 20px;row-gap:1px; }
    :host([data-theme="chalk"]) .compact-grid .compact-muted { height:14px;line-height:14px;font-size:10px; }
    :host([data-theme="chalk"]) .compact-value { height:20px;line-height:20px!important;font-size:12px;letter-spacing:-.2px; }
    :host([data-theme="botanic"]) { --compact-note:var(--compact-muted);--compact-bg:#f7fcf3;--compact-ink:#164d3b;--compact-muted:#73917f;--compact-heading:#2e6953;--compact-border:#fffffff0;--compact-divider:#b2ceba77;--compact-track:#d2e5cb;--compact-fill:linear-gradient(90deg,#175747,#92b64e);--compact-dot:#3d7d58;--compact-entry:#277154;--compact-shadow:0 8px 20px #16583b12,inset 0 1px 0 #fff;--compact-light:radial-gradient(ellipse at 100% 0%,#b7dc7660,transparent 65%),radial-gradient(ellipse at 0% 100%,#b3dac86b,transparent 68%);--compact-font:"MonitorBarlow"; }
    :host([data-theme="botanic"][data-layout="compact"]) .usage-popover { border-radius:18px!important; }
    :host([data-theme="botanic"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-theme="botanic"]) .compact-grid>div { box-sizing:border-box;padding:3px 5px;grid-template-rows:14px 20px;row-gap:1px; }
    :host([data-theme="botanic"]) .compact-grid .compact-muted { height:14px;line-height:14px;font-size:10px; }
    :host([data-theme="botanic"]) .compact-value { height:20px;line-height:20px!important;font-size:12px;letter-spacing:-.2px; }
    :host([data-theme="smoke"]) { --compact-note:var(--compact-muted);--compact-bg:#5b5353bb;--compact-ink:#f5f3ef;--compact-muted:#c3bdba;--compact-heading:#e5dfda;--compact-border:#e7ddd744;--compact-divider:#dfd4c329;--compact-track:#d1c9c229;--compact-fill:linear-gradient(90deg,#e3d0b4,#f0ede3);--compact-dot:#e4ba88;--compact-entry:#94744f;--compact-shadow:0 8px 22px #211c2222,inset 0 1px 0 #fff2;--compact-light:radial-gradient(ellipse at 85% 0%,#c19c7660,transparent 60%),radial-gradient(ellipse at 0% 95%,#343e43a0,transparent 70%); }
    :host([data-theme="smoke"][data-layout="compact"]) .usage-popover { border-radius:22px!important; }
    :host([data-theme="smoke"]) .compact-ring-value { stroke-opacity:1; }
    :host([data-theme="smoke"]) .compact-grid>div { box-sizing:border-box;padding:3px 5px;grid-template-rows:14px 20px;row-gap:1px; }
    :host([data-theme="smoke"]) .compact-grid .compact-muted { height:14px;line-height:14px;font-size:10px; }
    :host([data-theme="smoke"]) .compact-value { height:20px;line-height:20px!important;font-size:12px;letter-spacing:-.2px; }

    :host([data-theme="graphite"]) .compact-grid>div { border:1px solid #e9ebec;border-radius:5px;background:linear-gradient(#fafbfb,#fff); }
    :host([data-theme="graphite"]) .compact-value { font-size:14px;font-weight:600; }
    :host([data-theme="graphite"]) .compact-track { border-radius:2px; }
    :host([data-theme="mist"]) .usage-popover { backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px); }
    :host([data-theme="mist"]) .compact-grid>div { border:1px solid #ffffffb0;border-radius:12px;background:#ffffff59;box-shadow:inset 0 1px 0 #fff8; }
    :host([data-theme="chalk"]) .compact-grid>div { background:#f0efea;border:1px solid #e8e7df;border-radius:15px; }
    :host([data-theme="chalk"]) .compact-value { font-family:"MonitorLora","MonitorSans",serif;font-size:11px; }
    :host([data-theme="chalk"]) [data-context-count] { font-family:"MonitorLora","MonitorSans",serif; }
    :host([data-theme="botanic"]) .compact-grid>div { background:#ffffff80;border:1px solid #ffffffc0;border-radius:10px; }
    :host([data-theme="botanic"]) .compact-value { font-size:14px;font-weight:500; }
    :host([data-theme="botanic"]) [data-value="0"] { color:#47883d; }
    :host([data-theme="smoke"]) .usage-popover { backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px); }
    :host([data-theme="smoke"]) .compact-grid>div { background:#26272b30;border:1px solid #fff1;border-radius:12px; }
    :host([data-theme="smoke"]) .compact-track { box-shadow:inset 0 1px 2px #19181c22; }
  `;
  const number = n => valid(n) ? n.toLocaleString('en-US') + ' tok' : '0 tok';
  const short = n => valid(n) ? n >= 1e6 ? (n/1e6).toFixed(n%1e6 ? 2 : 0)+'M' : n >= 1000 ? Math.round(n/1000)+'K' : String(n) : '0';
  const render = (host, usage = {}) => {
    const root = host.shadowRoot;
    host.dataset.layout = 'compact';
    if (!root.querySelector('#compact-style')) {
      const style=document.createElement('style');style.id='compact-style';style.textContent=css;root.append(style);
      const panel=root.querySelector('.usage-popover');
      panel.setAttribute('aria-label','上下文与 Token 用量');
      panel.innerHTML='<div class="compact-context"><span><span class="compact-muted" data-context-label>上下文估算</span> <span data-context-percent>--</span></span><span data-context-count>-- / --</span></div><div class="compact-track" role="progressbar" aria-label="上下文占用"><div class="compact-fill"></div></div><div class="compact-heading">Token 用量</div><div class="compact-grid">'+['缓存命中','未缓存输入','缓存读取','输出'].map((label,i)=>'<div><div class="compact-muted">'+label+'</div><div class="compact-value" data-value="'+i+'">--</div></div>').join('')+'</div><div class="compact-note">当前会话累计 · 日志更新后刷新</div>';
      const content=document.createElement('div');content.className='compact-content';
      content.append(...panel.childNodes);panel.append(content);
      const note=content.querySelector('.compact-note');
      const footer=document.createElement('div');footer.className='compact-footer';footer.append(note);
      const toggle=document.createElement('button');toggle.type='button';toggle.className='compact-theme-toggle';
      toggle.addEventListener('click',event=>{
        event.stopPropagation();
        const state=window[registry.constants.STATE_KEY];
        const themes=registry.constants.THEMES;state?.setTheme?.(themes[(themes.indexOf(state.getSettings().theme)+1)%themes.length]);
      });
      footer.append(toggle);content.append(footer);
      const bridge=document.createElement('div');bridge.className='compact-hover-bridge';bridge.setAttribute('aria-hidden','true');root.append(bridge);
    }
    const current=window[registry.constants.STATE_KEY]?.getDisplaySettings?.().theme??window[registry.constants.STATE_KEY]?.getSettings?.().theme;
    const theme=registry.constants.THEMES.includes(current)?current:'white';
    if(host.dataset.theme!==theme)host.dataset.theme=theme;
    const toggle=root.querySelector('.compact-theme-toggle');
    const themeHint='切换为'+registry.constants.THEME_NAMES[(registry.constants.THEMES.indexOf(theme)+1)%registry.constants.THEMES.length]+'主题';
    if(toggle.getAttribute('aria-label')!==themeHint){toggle.setAttribute('aria-label',themeHint);toggle.title=themeHint;}
    const emptySession=isUnsentNewSession(host);
    const d=emptySession ? {inputTokens:0,cachedInputTokens:0,uncachedInputTokens:0,outputTokens:0,contextTokens:0,contextWindow:0} : usage.tokenDetails || {};
    const rate=valid(d.inputTokens) && valid(d.cachedInputTokens) && d.inputTokens>0 && d.cachedInputTokens<=d.inputTokens ? 100*d.cachedInputTokens/d.inputTokens : null;
    const hit=emptySession?'0%':rate===null?'0%':rate.toFixed(1)+'%';
    const summary=root.querySelector('.usage-summary');
    if (!summary.querySelector('.compact-context-ring')) {
      summary.innerHTML='<span class="compact-summary-content"><svg class="compact-context-ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="compact-ring-track" cx="10" cy="10" r="7"/><circle class="compact-ring-value" cx="10" cy="10" r="7" pathLength="100"/></svg><span class="compact-summary-value"></span></span>';
    }
    summary.removeAttribute('title');
    const vals=[hit,number(d.uncachedInputTokens),number(d.cachedInputTokens),number(d.outputTokens)];
    vals.forEach((v,i)=>{setText(root.querySelector('[data-value="'+i+'"]'),v);});
    const backend=window.__CODEX_USAGE_MONITOR_BACKEND__;
    const disconnected=backend && (!Number.isFinite(backend.at) || Date.now()-backend.at>30000);
    setText(root.querySelector('.compact-note'),emptySession ? '新会话 · 尚未发送消息' : disconnected ? '连接已中断 · 以下为最后一次统计' : usage.currentThreadId ? '当前会话累计 · 日志更新后刷新' : '尚未识别当前会话');
    const native=host.__compactContext;
    const label=text(native);
    const match=label.match(/(\d+(?:\.\d+)?)\s*%/);
    const usedMatch=label.match(/(?:已用|已使用|used)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i) || label.match(/(\d+(?:\.\d+)?)\s*%\s*(?:已用|已使用|used)/i);
    const remainingMatch=label.match(/(?:剩余|remaining)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i) || label.match(/(\d+(?:\.\d+)?)\s*%\s*(?:剩余|remaining)/i);
    const reported=native?.getAttribute('aria-valuenow');
    const maximum=Number(native?.getAttribute('aria-valuemax') || 100);
    const reportedRate=reported!==null && reported!==undefined && Number.isFinite(Number(reported)) && maximum>0 ? 100*Number(reported)/maximum : match ? Number(match[1]) : null;
    const usedRate=usedMatch ? Number(usedMatch[1]) : remainingMatch ? 100-Number(remainingMatch[1]) : reportedRate;
    const nativeRate=usedRate!==null && usedRate>=0 && usedRate<=100 ? usedRate : null;
    const estimate=valid(d.contextTokens)&&valid(d.contextWindow)&&d.contextWindow>0 ? 100*d.contextTokens/d.contextWindow : null;
    const percent=emptySession ? 0 : nativeRate ?? estimate ?? 0;
    const contextHit=Math.round(percent)+'%';
    setText(summary.querySelector('.compact-summary-value'),contextHit);
    summary.querySelector('.compact-ring-value').setAttribute('stroke-dasharray',Math.max(0,Math.min(100,percent ?? 0))+' 100');
    summary.setAttribute('aria-label',(emptySession||nativeRate!==null?'上下文已用 ':'上下文占用估算 ')+contextHit+'，查看 Token 用量');
    setText(root.querySelector('[data-context-label]'),emptySession||nativeRate!==null?'上下文已用':'上下文估算');
    setText(root.querySelector('[data-context-percent]'),Math.round(percent)+'%');
    setText(root.querySelector('[data-context-count]'),emptySession?'0 / 0':'~'+short(d.contextTokens)+' / '+short(d.contextWindow));
    root.querySelector('.compact-fill').style.width=Math.max(0,Math.min(100,percent ?? 0))+'%';
    const track=root.querySelector('.compact-track');
    if(percent===null)track.removeAttribute('aria-valuenow');else track.setAttribute('aria-valuenow',String(percent));
    track.title=emptySession?'尚未发送消息，初始化显示为零':nativeRate!==null?'百分比来自原生控件；Token 数来自最近请求日志':'最近请求 Token / 日志报告窗口上限，可能与原生占用口径不同';
    host.dataset.rendered='true';
  };
  const configurePosition = (host, composer) => {
    const control=findContextControl(composer);host.__compactContext=control;
    if(control)hideNative(control);else restoreNative();
    const model=findModelControl(composer);host.__compactModel=model;
    if(!model){host.hidden=true;return {ok:false,reason:'model-control-not-found',anchor:'none',availableWidth:0};}
    const r=model.getBoundingClientRect();
    const width=66;
    const height=host.getBoundingClientRect().height || 18.4;
    const targetCenter=modelTextCenter(model);
    const left=Math.round(r.left-width-4),top=targetCenter-height/2;
    const blocked=[...composer.querySelectorAll('button,[role="button"]')].some(n=>{
      if(n===model || n.contains(model) || model.contains(n) || (control && (n===control || n.contains(control) || control.contains(n))))return false;
      const b=n.getBoundingClientRect();return b.width>0 && b.height>0 && b.left<r.left-4 && b.right>left && b.top<top+height && b.bottom>top;
    });
    host.hidden=left<12 || blocked;
    host.style.setProperty('--usage-left',left+'px');host.style.setProperty('--usage-top',top+'px');host.style.setProperty('--usage-max-width','120px');
    render(host,window[registry.constants.STATE_KEY]?.usage);
    // Align using rendered geometry, including any inherited CSS zoom or
    // transformed containing block. CSS top and viewport top can differ.
    const hostRect=host.getBoundingClientRect();
    const ring=host.shadowRoot.querySelector('.compact-context-ring');
    ring.style.transform='rotate(-90deg)';
    const ringRect=ring.getBoundingClientRect();
    if(!host.hidden && ringRect.height>0 && hostRect.height>0) {
      const scale=ringRect.height/16;
      host.style.setProperty('--usage-top',(top+(targetCenter-ringRect.top-ringRect.height/2)/scale)+'px');
      // Match the number's visible ink to the circle, not its font line box.
      const value=host.shadowRoot.querySelector('.compact-summary-value');
      value.style.removeProperty('transform');
      const range=document.createRange();range.selectNodeContents(value);
      const valueRect=range.getBoundingClientRect?.();
      if(valueRect?.height>0 && value.firstChild) {
        const currentRing=ring.getBoundingClientRect();
        const shift=(currentRing.top+currentRing.height/2-visibleTextCenter(value.firstChild,valueRect,false,'00%'))/scale;
        value.style.transform=`translateY(${shift}px)`;
        // Move the whole entry after centering its contents, so the ring
        // accompanies the percentage while the two text bottoms line up.
        const bottomRect=range.getBoundingClientRect();
        const bottomDelta=modelTextCenter(model,true)-visibleTextCenter(value.firstChild,bottomRect,true,'00%');
        const currentTop=Number.parseFloat(host.style.getPropertyValue('--usage-top'));
        // Small optical offset requested for the ring and percentage together.
        host.style.setProperty('--usage-top',(currentTop+(bottomDelta+2)/scale)+'px');
      }
    }
    // Align the painted stroke edge, not the SVG box, to the current text ink.
    // The entry/reference alignment above stays unchanged.
    ring.style.transform='rotate(-90deg)';
    const numberNode=host.shadowRoot.querySelector('.compact-summary-value');
    const numberRange=document.createRange();numberRange.selectNodeContents(numberNode);
    const numberRect=numberRange.getBoundingClientRect?.();
    const paintedRing=ring.getBoundingClientRect();
    if(!host.hidden&&numberRect?.height>0&&numberNode.firstChild&&paintedRing.height>0){
      const track=ring.querySelector('.compact-ring-track');
      const viewBox=(ring.getAttribute('viewBox')||'0 0 20 20').split(/[ ,]+/).map(Number);
      const stroke=Number.parseFloat(getComputedStyle(track).strokeWidth)||2.5;
      const paintedBottom=paintedRing.top+(Number(track.getAttribute('cy'))+Number(track.getAttribute('r'))+stroke/2-viewBox[1])*paintedRing.height/viewBox[3];
      const numberBottom=visibleTextCenter(numberNode.firstChild,numberRect,true);
      const offset=(numberBottom-paintedBottom)/(paintedRing.height/16);
      ring.style.transform=`translateY(${offset}px) rotate(-90deg)`;
    }
    const measuredSummaryWidth=host.shadowRoot.querySelector('.usage-summary').getBoundingClientRect().width;
    const summaryWidth=measuredSummaryWidth>0 && measuredSummaryWidth<=width ? measuredSummaryWidth : width;
    const panelWidth=Math.min(284,Math.max(0,window.innerWidth-24));
    const entryCenter=left+width-summaryWidth/2;
    const panelLeft=Math.max(12,Math.min(window.innerWidth-panelWidth-12,entryCenter-panelWidth/2));
    host.style.setProperty('--compact-shift',(panelLeft-(left+width-panelWidth))+'px');
    host.dataset.anchor='model-selector-left';
    return {ok:!host.hidden,reason:host.hidden?'insufficient-model-gap':null,anchor:'model-selector-left',availableWidth:width};
  };
  registry.compact=Object.freeze({render,configurePosition,findContextControl,findModelControl,restoreNative,isUnsentNewSession,modelTextCenter});
})();
