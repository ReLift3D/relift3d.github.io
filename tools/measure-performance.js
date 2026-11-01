(() => {
  performance.setResourceTimingBufferSize(2000);
  const samples = [], errors = [], longTasks = [], visibilityEvents = [];
  document.addEventListener('visibilitychange', () => setTimeout(() => visibilityEvents.push({time:performance.now(),hidden:document.hidden,playing:[...document.querySelectorAll('video')].filter(v=>!v.paused).length}),0));
  let draws = 0, rafCallbacks = 0;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = cb => raf.call(window, t => { rafCallbacks++; cb(t); });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) {
    for (const key of ['drawArrays', 'drawElements']) {
      const original = C.prototype[key];
      C.prototype[key] = function (...args) { draws++; return original.apply(this, args); };
    }
  }
  addEventListener('error', e => errors.push(e.message || e.target?.src || 'resource error'), true);
  addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  try { new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true}); } catch (_) {}
  function sample() {
    const resources = performance.getEntriesByType('resource').map(r => ({name:new URL(r.name).pathname,bytes:r.transferSize,encoded:r.encodedBodySize,duration:r.duration}));
    const videos = [...document.querySelectorAll('video')].map(v => ({src:v.currentSrc,paused:v.paused,ready:v.readyState,time:v.currentTime,width:v.videoWidth,height:v.videoHeight,quality:v.getVideoPlaybackQuality?.()}));
    return {time:performance.now(),viewport:[innerWidth,innerHeight],hidden:document.hidden,requests:resources.length,transferBytes:resources.reduce((s,r)=>s+r.bytes,0),resources,videos,draws,rafCallbacks,longTasks:longTasks.map(t=>({...t})),errors:[...errors],heap:performance.memory?.usedJSHeapSize,frame:document.getElementById('frame')?.textContent,sections:[...document.querySelectorAll('body > section')].map(s=>({name:s.querySelector('h2,h1')?.textContent,top:s.offsetTop,height:s.offsetHeight}))};
  }
  function publish() {
    let output = document.getElementById('__performance');
    if (!output) { output=document.createElement('script'); output.id='__performance'; output.type='application/json'; document.body.appendChild(output); }
    output.textContent=JSON.stringify({samples,current:sample(),visibilityEvents});
    output.dataset.ready=String(samples.length>0);
  }
  addEventListener('DOMContentLoaded',()=> {setInterval(publish,1000); for (const ms of [5000,15000]) setTimeout(()=>{samples.push(sample());publish();},ms);});
})();
