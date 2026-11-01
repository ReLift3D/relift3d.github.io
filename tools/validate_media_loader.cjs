// Deterministic media lifecycle tests; real decoding/layout are checked in a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/js/relift-media-loader.js'), 'utf8');
function harness({composite = false, supported = true, method = false, panelSizes = [], cellWidth = 960, cellHeight = 540} = {}) {
  class E {
    constructor(tag='DIV') { this.tagName=tag; this.events={}; this.dataset={}; this.attrs={}; this.style={}; this.children=[]; this.className=''; }
    addEventListener(name, cb) { (this.events[name] ||= []).push(cb); }
    emit(name) { for(const cb of this.events[name] || []) cb({target:this}); }
    setAttribute(name,value) { this.attrs[name]=value; }
    hasAttribute(name) { return name in this.attrs; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    querySelectorAll(sel) { if(sel === 'video') return this.children.filter(x=>x.tagName==='VIDEO'); return []; }
    querySelector() { return null; }
    closest() { return null; }
    getBoundingClientRect() { return {width: 480, height:270, top:0, bottom:270}; }
    appendChild(e) { this.children.push(e); e.parentElement=this; }
    replaceWith(e) { const p=this.parentElement; const i=p.children.indexOf(this); p.children[i]=e; e.parentElement=p; this.parentElement=null; }
    remove() { const p=this.parentElement; if(p) p.children.splice(p.children.indexOf(this),1); }
  }
  class V extends E {
    constructor() { super('VIDEO'); this.readyState=0; this.currentTime=0; this.paused=true; this.seeking=false; this.error=null; this.loads=0; this.plays=0; this.callbacks=new Map(); this.nextFrame=0; }
    set src(value) { this.attrs.src=value; }
    get src() { return this.attrs.src || ''; }
    load() { this.loads++; }
    play() { this.plays++; if(this.paused) Promise.resolve().then(()=>this.emit('play')); this.paused=false; return Promise.resolve(); }
    pause() { if(!this.paused) Promise.resolve().then(()=>this.emit('pause')); this.paused=true; }
    requestVideoFrameCallback(cb) { const id=++this.nextFrame; this.callbacks.set(id,cb); return id; }
    cancelVideoFrameCallback(id) { this.callbacks.delete(id); }
    frame() { const callbacks=[...this.callbacks.values()]; this.callbacks.clear(); for(const cb of callbacks) cb(); }
  }
  if(!supported) delete V.prototype.requestVideoFrameCallback;
  class C extends E {
    constructor() { super('CANVAS'); this.draws=[]; }
    getContext() { return {drawImage:(...args)=>this.draws.push(args)}; }
  }
  const originals=method?[new V()]:[new V(),new V()]; const root=method?originals[0]:new E(); if(method) root.controls=true;
  for(let i=0;i<originals.length;i++) {
    originals[i].dataset.src=`original${i}.mp4`; originals[i].dataset.poster=`original${i}.jpg`;
    for(const dimension of ['width', 'height']) {
      if(panelSizes[i]?.[dimension] !== undefined) originals[i].setAttribute(dimension,String(panelSizes[i][dimension]));
    }
    if(!method) root.appendChild(originals[i]);
  }
  if(composite) Object.assign(root.dataset,{compositeSrc:'atlas.mp4',panelWidth:String(cellWidth),panelHeight:String(cellHeight),atlasColumns:'2'});
  const observers=[];
  class IO { constructor(cb, options) { this.cb=cb; this.options=options; observers.push(this); } observe(){} }
  class RO { constructor(){} observe(){} }
  const doc=new E(); doc.hidden=false; doc.querySelectorAll=()=>[root]; doc.createElement=tag=>tag==='video'?new V():new C();
  const win=new E(); win.devicePixelRatio=2; win.IntersectionObserver=IO; win.ResizeObserver=RO;
  vm.runInNewContext(source,{document:doc,window:win,HTMLVideoElement:V,IntersectionObserver:IO,ResizeObserver:RO,Promise,Map,Math,Number,String,Array,JSON});
  const intersect=(index,visible)=>observers[index].cb([{target:root,isIntersecting:visible,intersectionRatio:visible?1:0}]);
  return {root,originals,doc,near:(value)=>intersect(0,value),visible:(value)=>intersect(1,value),decoder:()=>root.children.find(e=>e.className==='media-decoder')};
}
(async()=>{
  const h=harness();
  assert(h.originals.every(v=>v.src===''&&v.loads===0&&v.plays===0),'initial sources must be inert');
  h.near(true);
  assert(h.originals.every(v=>v.loads===1&&v.plays===0),'near viewport loads without playing');
  h.visible(true);
  h.originals[0].readyState=2; h.originals[0].emit('canplay');
  assert(h.originals.every(v=>v.plays===0),'do not partially start a group');
  h.originals[1].readyState=2; h.originals[1].emit('canplay');
  await Promise.resolve(); await Promise.resolve();
  assert(h.originals.every(v=>v.plays===1&&!v.paused));
  h.visible(false); h.root.emit('pointerdown');
  assert(h.originals.every(v=>v.paused&&v.plays===1),'offscreen click must not restart playback');
  h.visible(true); await Promise.resolve(); await Promise.resolve();
  h.doc.hidden=true; h.doc.emit('visibilitychange');
  assert(h.originals.every(v=>v.paused),'hidden document pauses all media');

  const c=harness({composite:true});
  assert.equal(c.decoder(),undefined, 'no decoder allocated before approaching the viewport');
  assert(c.root.children.every(e=>e.tagName!=='CANVAS'), 'no canvas contexts allocated at startup');
  c.near(true); const d=c.decoder(); assert(d.loads===1 && d.src==='atlas.mp4');
  assert(c.originals.every(v=>v.src===''&&v.loads===0),'atlas mode never loads original MP4s');
  c.visible(true); d.readyState=2; d.videoWidth=1920; d.videoHeight=540; d.emit('canplay');
  await Promise.resolve(); await Promise.resolve();
  const panels=c.root.children.filter(e=>e.tagName==='CANVAS');
  const before=panels[0].draws.length; d.frame();
  assert(panels.every(p=>p.draws.length===before+1));
  assert.equal(panels[0].draws.at(-1)[1],0); assert.equal(panels[1].draws.at(-1)[1],960);
  assert.equal(d.callbacks.size,1); c.visible(false); assert.equal(d.callbacks.size,0); assert(d.paused);
  c.visible(true); d.emit('error');
  assert.equal(c.root.dataset.mediaMode,'original');
  assert(c.originals.every(v=>v.parentElement===c.root&&v.loads===1),'decode error restores and loads original sources');
  c.near(false); c.near(true); assert.equal(c.decoder(),undefined,'failed composite must not be attempted again');

  const mixed=harness({composite:true, cellWidth:1000, cellHeight:562,
    panelSizes:[{width:960,height:540},{width:1000,height:562}]});
  mixed.near(true);
  const mixedDecoder=mixed.decoder(), mixedPanels=mixed.root.children.filter(e=>e.tagName==='CANVAS');
  assert.deepEqual(mixedPanels.map(p=>[p.width,p.height,p.style.aspectRatio]),
    [[960,540,'960 / 540'],[1000,562,'1000 / 562']], 'each canvas starts with its native dimensions and aspect ratio');
  mixedPanels.forEach(panel=>{ panel.getBoundingClientRect=()=>({width:800}); });
  mixed.visible(true); mixedDecoder.readyState=2; mixedDecoder.videoWidth=2000; mixedDecoder.videoHeight=562; mixedDecoder.emit('canplay');
  await Promise.resolve(); await Promise.resolve();
  mixedDecoder.frame();
  assert.deepEqual(mixedPanels[0].draws.at(-1).slice(1,5),[0,0,960,540], 'input crop excludes atlas padding');
  assert.deepEqual(mixedPanels[1].draws.at(-1).slice(1,5),[1000,0,1000,562], 'revised panel begins at the atlas cell offset');
  assert.deepEqual(mixedPanels.map(p=>[p.width,p.height]),[[960,540],[1000,562]], 'backing dimensions are capped independently at each source resolution');
  const mixedDraws=mixedPanels.map(p=>p.draws.length);
  mixed.visible(false); assert(mixedDecoder.paused); assert.equal(mixedDecoder.callbacks.size,0);
  mixedDecoder.frame(); assert.deepEqual(mixedPanels.map(p=>p.draws.length),mixedDraws, 'offscreen panels do not draw');
  mixed.visible(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(mixedDecoder.callbacks.size,1, 'mixed-size composite resumes its shared frame callback');
  mixedDecoder.frame(); assert(mixedPanels.every((p,i)=>p.draws.length>mixedDraws[i]));
  mixedDecoder.emit('error');
  assert.equal(mixed.root.dataset.mediaMode,'original');
  assert(mixed.originals.every(v=>v.parentElement===mixed.root));
  assert.deepEqual(mixed.originals.map(v=>[v.getAttribute('width'),v.getAttribute('height')]),
    [['960','540'],['1000','562']], 'fallback retains each original video and its native dimensions');

  for(const invalid of [{width:1001,height:562},{width:1000,height:563},{width:0,height:562},
    {width:-1,height:562},{width:999.5,height:562},{width:'not-a-number',height:562},{width:'',height:562}]) {
    const bad=harness({composite:true,cellWidth:1000,cellHeight:562,panelSizes:[{width:960,height:540},invalid]});
    bad.near(true);
    assert.equal(bad.decoder(),undefined,'invalid/out-of-cell dimensions must reject the composite');
    assert(bad.originals.every(v=>v.parentElement===bad.root&&v.loads===1),'validate every panel before replacing any source video');
    assert(bad.root.children.every(e=>e.tagName==='VIDEO'));
  }

  const unsupported=harness({composite:true,supported:false});
  unsupported.near(true); assert.equal(unsupported.decoder(),undefined); assert.equal(unsupported.root.dataset.mediaMode,'original');
  const m=harness({method:true}); const mv=m.originals[0];
  m.near(true); m.visible(true); mv.readyState=2; mv.emit('canplay');
  await Promise.resolve(); await Promise.resolve();
  mv.pause(); await Promise.resolve();
  const plays=mv.plays; m.visible(false); m.visible(true); mv.emit('canplay');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(mv.plays, plays, 'user pause must survive viewport exit/reentry');
  mv.play(); await Promise.resolve();
  m.visible(false); await Promise.resolve(); m.visible(true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(mv.plays, plays+2, 'native play restores viewport-managed resume');
  console.log('PASS: lazy decoder/canvas allocation, one-shot fallback, source gating, group readiness, viewport/hidden pause, offscreen click, one-decoder panel drawing, mixed native dimensions/crops, invalid panel rejection, callback cancellation, decode fallback, unsupported fallback, native pause persistence and native play resume.');
})();
