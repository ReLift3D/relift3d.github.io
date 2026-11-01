// Exercise the actual viewer with synthetic scene data and a small DOM/THREE
// boundary. This checks presentation/lifecycle wiring; browser checks remain
// responsible for raster quality, GPU behavior and interaction appearance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const viewerPath = path.join(__dirname, '../static/js/relift-viewer.js');
const source = fs.readFileSync(viewerPath, 'utf8');
const {cloudPointSizes, rendererPixelRatio, framingFov} = require(viewerPath);
const NAMES = ['cartwheel', 'running', 'swing-tire', 'swing', 'spin', 'forest', 'tennis', 'motocross-bumps', 'drift-turn'];
const LARGE_DYNAMIC = new Set(['swing-tire', 'swing', 'spin', 'motocross-bumps']);
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-10,
  `${message}: expected ${expected}, got ${actual}`);

function expectedSizes(name) {
  return {background: 2.7,
    dynamic: name === 'spin' ? 4.5 : LARGE_DYNAMIC.has(name) ? 3.2 : 2.4};
}
function checkHelpers() {
  for (const name of NAMES) {
    const actual = cloudPointSizes(name), expected = expectedSizes(name);
    close(actual.background, expected.background, `${name} background CSS pixels`);
    close(actual.dynamic, expected.dynamic, `${name} dynamic CSS pixels`);
    for (const fov of [30, 45, 75]) {
      const original = name === 'forest' ? fov * 1.2 : fov;
      const revised = framingFov(name, fov);
      if (name === 'forest' || name === 'motocross-bumps') {
        // Projected subject size scales with 1/tan(FOV/2). A 10% reduction
        // must preserve the previous Forest widening and camera position.
        close(Math.tan(original * Math.PI / 360) / Math.tan(revised * Math.PI / 360),
          0.9, `${name} projected size ratio`);
      } else close(revised, original, `${name} unchanged framing`);
    }
  }
  for (const [input, expected] of [[1,1], [1.5,1.5], [2,2], [3,2], [0,1], [-1,1], [NaN,1], [Infinity,1], [undefined,1]]) {
    assert.equal(rendererPixelRatio(input), expected, `safe renderer DPR for ${input}`);
  }
  assert.equal(framingFov('forest', 149), 150, 'framing keeps the original upper FOV bound');
}

function syntheticScene() {
  const half = values => Buffer.from(new Uint16Array(values).buffer).toString('base64');
  const bytes = values => Buffer.from(values).toString('base64');
  return {
    meta: {T:2, Q:1, fps:12, dyn_offsets:[0,1,2], camera:{position:[2,3,4],target:[0,0,0],up:[0,1,0],fov:45}},
    sxyz:half([0,0,0]), srgb:bytes([255,0,0]),
    dxyz:half([0,0,0,0x3c00,0,0]), drgb:bytes([0,255,0,0,255,0]),
    tracks:half([0,0,0,0x3c00,0,0]),
  };
}

function harness(dpr, width, {matchMedia = true} = {}) {
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    emit(type, event = {}) { for (const callback of [...(this.listeners.get(type) || [])]) callback({target:this, ...event}); }
    count(type) { return this.listeners.get(type)?.size || 0; }
  }
  class Element extends Events {
    constructor(tag='div') {
      super(); this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.dataset={}; this.style={}; this.className='';
      this.clientWidth=width; this.clientHeight=Math.round(width*9/16); this.offsetLeft=0; this.offsetWidth=100;
      this.classList={toggle:(name,on)=>{
        const names=new Set(this.className.split(/\s+/).filter(Boolean));
        if (on === undefined ? !names.has(name) : on) names.add(name); else names.delete(name);
        this.className=[...names].join(' ');
      }};
    }
    appendChild(element) { element.parentElement=this; this.children.push(element); return element; }
    remove() { if (this.parentElement) this.parentElement.children=this.parentElement.children.filter(child=>child!==this); }
    setAttribute(name,value) { this.attributes[name]=String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    querySelectorAll(selector) {
      return this.children.flatMap(child=>[
        ...(selector === 'video' && child.tagName === 'VIDEO' || selector === '.demo-thumb' && child.className.split(' ').includes('demo-thumb') ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    scrollTo(options) { this.scrollLeft=options.left; }
  }
  class Video extends Element {
    constructor() { super('video'); this.readyState=0; this.paused=true; this.currentTime=0; this.duration=2/12; this.seeking=false; this.loads=0; }
    set src(value) { this.setAttribute('src',value); }
    get src() { return this.getAttribute('src') || ''; }
    load() { this.loads++; this.readyState=2; }
    play() { this.paused=false; return Promise.resolve(); }
    pause() { this.paused=true; }
  }
  const elements=Object.fromEntries(['stage','status','scenes','slider','play','tail','reset','frame'].map(id=>[id,new Element()]));
  const document=new Events(); document.hidden=false; document.getElementById=id=>elements[id];
  document.createElement=tag=>tag==='video'?new Video():new Element(tag);
  document.head=new Element('head');
  const window=new Events(); window.devicePixelRatio=dpr; window.SUPP={};
  const scripts=[], errors=[], renderers=[], cameras=[], orbitControls=[], scenes=[], queries=[], resizeObservers=[], observers=[];
  const frames=new Map(); let frameId=0, time=0;
  document.head.appendChild=element=>{
    scripts.push(element.src);
    const match=/\/static\/data\/(.+)\.js$/.exec(element.src);
    assert(match, `unexpected script request: ${element.src}`);
    window.SUPP[match[1]]=syntheticScene();
    Promise.resolve().then(()=>element.onload());
    return element;
  };
  if (matchMedia) window.matchMedia=query=>{
    const result=new Events(); result.media=query;
    if (matchMedia === 'legacy') {
      result.addEventListener=undefined; result.removeEventListener=undefined;
      result.addListener=callback=>Events.prototype.addEventListener.call(result,'change',callback);
      result.removeListener=callback=>Events.prototype.removeEventListener.call(result,'change',callback);
    }
    queries.push(result); return result;
  };
  class Vector3 {
    constructor(x=0,y=0,z=0) { this.set(x,y,z); }
    set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
    add(other) { this.x+=other.x; this.y+=other.y; this.z+=other.z; return this; }
    values() { return [this.x,this.y,this.z]; }
  }
  class Geometry {
    constructor() { this.attributes={}; }
    setAttribute(name,value) { this.attributes[name]=value; return this; }
    setDrawRange(start,count) { this.drawRange={start,count}; }
    dispose() { this.disposed=true; }
  }
  class Material {
    constructor(options) { Object.assign(this,options); }
    dispose() { this.disposed=true; }
  }
  class Points {
    constructor(geometry,material) { Object.assign(this,{geometry,material}); }
  }
  const THREE={
    Vector3, BufferGeometry:Geometry,
    BufferAttribute:class { constructor(array,itemSize,normalized=false) { Object.assign(this,{array,itemSize,normalized}); } },
    PointsMaterial:Material, ShaderMaterial:Material, Points, LineSegments:Points,
    Scene:class {
      constructor() { this.children=[]; scenes.push(this); }
      add(child) { this.children.push(child); }
      traverse(callback) { this.children.forEach(callback); }
    },
    WebGLRenderer:class {
      constructor(options) { this.options=options; this.domElement=new Element('canvas'); this.renders=0; this.pixelRatio=1; renderers.push(this); }
      setPixelRatio(value) { this.pixelRatio=value; }
      getPixelRatio() { return this.pixelRatio; }
      setClearColor() {}
      setSize(w,h,updateStyle) {
        this.width=w; this.height=h; this.updateStyle=updateStyle;
        this.domElement.width=Math.floor(w*this.pixelRatio); this.domElement.height=Math.floor(h*this.pixelRatio);
      }
      render(scene,camera) { this.renders++; this.lastScene=scene; this.lastCamera=camera; }
    },
    PerspectiveCamera:class {
      constructor(fov,aspect) { this.fov=fov; this.aspect=aspect; this.position=new Vector3(); this.up=new Vector3(); cameras.push(this); }
      updateProjectionMatrix() { this.projectionUpdates=(this.projectionUpdates||0)+1; }
    },
    OrbitControls:class {
      constructor(camera,element) { this.camera=camera; this.element=element; this.target=new Vector3(); this.enableZoom=true; orbitControls.push(this); }
      update() {}
    },
  };
  window.THREE=THREE;
  class IntersectionObserver {
    constructor(callback,options={}) { this.callback=callback; this.options=options; this.targets=new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
  }
  class ResizeObserver {
    constructor(callback) { this.callback=callback; resizeObservers.push(this); }
    observe(target) { this.target=target; }
  }
  window.IntersectionObserver=IntersectionObserver;
  const requestAnimationFrame=callback=>{ const id=++frameId; frames.set(id,callback); return id; };
  const cancelAnimationFrame=id=>frames.delete(id);
  vm.runInNewContext(source, {document,window,THREE,IntersectionObserver,ResizeObserver,
    requestAnimationFrame,cancelAnimationFrame,performance:{now:()=>time},
    atob:value=>Buffer.from(value,'base64').toString('binary'),
    setTimeout:()=>{ throw new Error('ready synthetic videos should not need readiness timers'); }, clearTimeout:()=>{},
    console:{error:error=>errors.push(error)},
  }, {filename:viewerPath});
  const intersect=(near,value)=>{
    const observer=observers.find(item=>item.targets.has(elements.stage) && Boolean(item.options.rootMargin)===near);
    assert(observer,'stage intersection observer exists');
    observer.callback([{target:elements.stage,isIntersecting:value,intersectionRatio:value?1:0}]);
  };
  return {elements,window,document,scripts,errors,renderers,cameras,orbitControls,scenes,queries,frames,
    videos:()=>elements.scenes.querySelectorAll('video'),
    near:value=>intersect(true,value), visible:value=>intersect(false,value),
    button:name=>elements.scenes.children.find(button=>button.getAttribute('aria-label')===`Show the ${name} demo`),
    resize:(newWidth,newHeight=Math.round(newWidth*9/16))=>{
      elements.stage.clientWidth=newWidth; elements.stage.clientHeight=newHeight;
      resizeObservers.forEach(observer=>observer.callback([{target:observer.target}]));
    },
    density:value=>{ window.devicePixelRatio=value; assert(queries.length); queries.at(-1).emit('change'); },
    frame:()=>{ time+=1000/60; const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(callback=>callback(time)); },
  };
}

const flush=async()=>{ for(let i=0;i<12;i++) await Promise.resolve(); };
function assertPresentation(test,name,dpr,width) {
  const renderer=test.renderers[0], camera=test.cameras[0], controls=test.orbitControls[0];
  const [background,dynamic,,heads]=test.scenes.at(-1).children;
  const expected=expectedSizes(name), ratio=Math.min(dpr,2);
  close(background.material.size,expected.background,`${name} runtime background CSS pixels at DPR ${dpr}`);
  close(dynamic.material.size,expected.dynamic,`${name} runtime dynamic CSS pixels at DPR ${dpr}`);
  close(heads.material.size,(name === 'running' ? 1.44 : 2.4)*ratio,
    `${name} scene-specific track-head material size at DPR ${dpr}`);
  assert.equal(background.material.sizeAttenuation,false); assert.equal(dynamic.material.sizeAttenuation,false);
  assert.equal(renderer.getPixelRatio(),ratio); assert.equal(renderer.width,width);
  assert.equal(renderer.height,test.elements.stage.clientHeight);
  assert.equal(renderer.domElement.width,Math.floor(width*ratio));
  assert.equal(renderer.domElement.height,Math.floor(test.elements.stage.clientHeight*ratio));
  assert.equal(renderer.updateStyle,false,'renderer must not replace responsive canvas CSS sizes');
  close(camera.aspect,width/test.elements.stage.clientHeight,'camera tracks stage aspect');
  assert.equal(controls.enableZoom,false,'orbit controls keep zoom disabled');
  close(camera.fov,framingFov(name,45),`${name} runtime framing uses source FOV`);
}

async function checkRuntime(dpr,width) {
  const test=harness(dpr,width);
  assert.equal(test.renderers.length,0,'renderer allocation is lazy');
  assert.equal(test.scripts.length,0,'scene downloads are lazy');
  assert.equal(test.frames.size,0,'no initial RAF work');
  assert.equal(test.videos().length,9); assert(test.videos().every(video=>!video.src&&video.paused));
  test.near(true); await flush();
  assert.equal(test.renderers.length,1); assert.deepEqual(test.scripts,['./static/data/cartwheel.js']);
  assert.equal(test.frames.size,0,'near-but-offscreen preparation does not render');
  assert(test.videos().every(video=>video.paused));
  assertPresentation(test,'cartwheel',dpr,width);
  test.visible(true); await flush();
  assert.equal(test.frames.size,1,'visible scene schedules one RAF');
  assert.equal(test.orbitControls[0].enabled,true);
  test.frame(); assert.equal(test.renderers[0].renders,1); assert.equal(test.frames.size,1);
  for(const name of ['spin','forest','motocross-bumps']) {
    test.button(name).emit('click'); await flush();
    assertPresentation(test,name,dpr,width);
    assert.equal(test.frames.size,1,'switching scenes does not duplicate RAF loops');
  }
  const camera=test.cameras[0], controls=test.orbitControls[0];
  camera.position.set(7,8,9); camera.up.set(0,0,1); controls.target.set(-1,-2,-3);
  const orbit={position:camera.position.values(),up:camera.up.values(),target:controls.target.values(),fov:camera.fov};
  const resizedWidth=width===900?390:900;
  test.resize(resizedWidth);
  assertPresentation(test,'motocross-bumps',dpr,resizedWidth);
  for(const nextDpr of [1,2,3]) {
    test.density(nextDpr);
    assertPresentation(test,'motocross-bumps',nextDpr,resizedWidth);
    assert.equal(test.queries.at(-1).count('change'),1);
    assert(test.queries.slice(0,-1).every(query=>query.count('change')===0),'DPR listeners are replaced, not accumulated');
  }
  assert.deepEqual({position:camera.position.values(),up:camera.up.values(),target:controls.target.values(),fov:camera.fov},
    orbit,'resize and DPR updates preserve the user camera orbit and framing');
  test.visible(false);
  assert.equal(test.frames.size,0,'offscreen transition cancels RAF'); assert.equal(controls.enabled,false);
  const renders=test.renderers[0].renders; test.frame();
  assert.equal(test.renderers[0].renders,renders); assert(test.videos().every(video=>video.paused));
  test.density(1); assert.equal(test.frames.size,0,'offscreen DPR changes do not start a loop');
  test.visible(true); assert.equal(test.frames.size,1);
  test.button('spin').emit('mouseenter'); assert(test.videos().some(video=>!video.paused));
  test.document.hidden=true; test.document.emit('visibilitychange');
  assert.equal(test.frames.size,0,'hidden document cancels RAF'); assert.equal(controls.enabled,false);
  assert(test.videos().every(video=>video.paused),'hidden document pauses active and hover videos');
  test.document.hidden=false; test.document.emit('visibilitychange');
  assert.equal(test.frames.size,1,'returning to a visible document resumes one loop');
  assert.equal(controls.enableZoom,false);
  assert.deepEqual(test.errors,[],'viewer completed without caught runtime errors');
}

(async()=>{
  checkHelpers();
  for(const dpr of [1,2,3]) for(const width of [900,390]) await checkRuntime(dpr,width);
  const fallback=harness(1,900,{matchMedia:false});
  fallback.near(true); await flush();
  fallback.window.devicePixelRatio=3;
  fallback.elements.stage.clientWidth=390; fallback.elements.stage.clientHeight=219;
  fallback.window.emit('resize');
  assertPresentation(fallback,'cartwheel',3,390);
  assert.equal(fallback.frames.size,0,'window resize fallback keeps an offscreen viewer idle');
  assert.deepEqual(fallback.errors,[]);
  const legacy=harness(1,390,{matchMedia:'legacy'});
  legacy.near(true); await flush();
  assertPresentation(legacy,'cartwheel',1,390);
  assert.equal(legacy.queries[0].addEventListener,undefined,'legacy query exposes only addListener/removeListener');
  assert.equal(legacy.queries[0].count('change'),1,'viewer registers the legacy density callback');
  for(const dpr of [2,3,1]) {
    legacy.density(dpr);
    assertPresentation(legacy,'cartwheel',dpr,390);
    assert.equal(legacy.queries.at(-1).count('change'),1,'legacy density callback is registered after each change');
    assert(legacy.queries.slice(0,-1).every(query=>query.count('change')===0),'legacy density callbacks are removed before replacement');
    assert.equal(legacy.frames.size,0,'legacy density updates keep an offscreen viewer idle');
  }
  legacy.visible(true); legacy.frame();
  assert.equal(legacy.renderers[0].renders,1,'legacy media queries do not block viewer initialization/playback');
  assert.deepEqual(legacy.errors,[],'legacy query path completes without caught runtime errors');
  console.log('PASS: CSS cloud sizes, reduced track-head size, framing projection, DPR 1/2/3 at 900/390px, resize/DPR orbit preservation, modern/legacy density listeners, disabled zoom, lazy loading, and offscreen/hidden RAF suspension.');
})().catch(error=>{ console.error(error); process.exitCode=1; });
