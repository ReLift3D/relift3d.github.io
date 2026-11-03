/* Local measurement-only instrumentation, injected by preview.py --measure.
 * Production HTML/assets are not changed. Five/15-second samples are scheduled
 * from DOMContentLoaded and include actual lateness. ResourceTiming reports only
 * completed responses; serverLedger counts local body bytes written so far,
 * including in-flight ranges. Neither is a substitute for the other.
 * Canonical comparable totals are siteRequests/siteTransferBytes (completed RT,
 * no HTML or diagnostic endpoints) and serverLedger.siteBodyBytesWritten (local
 * body bytes, no headers/HTML/diagnostics). Fonts on external origins are only
 * represented in RT and are not throttled by the preview server.
 */
(() => {
  'use strict';
  performance.setResourceTimingBufferSize(4000);
  const runId = document.currentScript?.dataset.run || null;
  const samples = [], errors = [], longTasks = [], visibilityEvents = [], actions = [], mediaEvents = [];
  const videoFrames = new WeakMap(), panelFrames = new WeakMap();
  const viewerFrames = [];
  let dclTime = null, draws = 0, rafCallbacks = 0, callbackId = 0, currentVideoFrame = null;
  let latestLedger = null, ledgerFailure = null, viewerUpdates = 0;
  const diagnostic = pathname => pathname.startsWith('/__measure');
  const boundedPush = (array, value, limit = 300) => { array.push(value); if (array.length > limit) array.shift(); };
  const pathname = value => { try { return new URL(value, location.href).pathname; } catch (_) { return value; } };

  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = cb => raf.call(window, time => { rafCallbacks++; cb(time); });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) {
    for (const key of ['drawArrays', 'drawElements']) {
      const original = C.prototype[key];
      C.prototype[key] = function (...args) { draws++; return original.apply(this, args); };
    }
  }
  if (HTMLVideoElement.prototype.requestVideoFrameCallback) {
    const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      const video = this;
      return request.call(video, (time, metadata) => {
        const previous = videoFrames.get(video);
        const frame = {id: ++callbackId, time, mediaTime: metadata.mediaTime,
          presentedFrames: metadata.presentedFrames, expectedDisplayTime: metadata.expectedDisplayTime,
          processingDuration: metadata.processingDuration, callbacks: (previous?.callbacks || 0) + 1};
        videoFrames.set(video, frame);
        const outer = currentVideoFrame;
        currentVideoFrame = {video, ...frame};
        try { callback(time, metadata); } finally { currentVideoFrame = outer; }
      });
    };
  }
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
    const result = drawImage.call(this, source, ...args);
    if (source instanceof HTMLVideoElement && this.canvas.classList.contains('media-panel')) {
      const frame = currentVideoFrame?.video === source ? currentVideoFrame : null;
      panelFrames.set(this.canvas, {callbackId: frame?.id ?? null,
        mediaTime: frame?.mediaTime ?? source.currentTime, time: performance.now(),
        crop: args.length === 8 ? args.slice(0, 4) : null,
        destination: [this.canvas.width, this.canvas.height]});
    }
    return result;
  };
  addEventListener('error', event => errors.push(event.message || event.target?.src || 'resource error'), true);
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  try {
    new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({start:entry.startTime,duration:entry.duration}))))
      .observe({type:'longtask',buffered:true});
  } catch (_) {}
  for (const type of ['waiting','stalled','seeking','seeked','playing','pause','error']) {
    document.addEventListener(type, event => {
      if (event.target instanceof HTMLVideoElement) boundedPush(mediaEvents,
        {type,time:performance.now(),src:pathname(event.target.currentSrc || event.target.dataset.src),mediaTime:event.target.currentTime});
    }, true);
  }
  document.addEventListener('visibilitychange', () => setTimeout(() => boundedPush(visibilityEvents,
    {time:performance.now(),hidden:document.hidden,playing:[...document.querySelectorAll('video')].filter(video=>!video.paused).length}),0));

  function groupRoots() {
    return [...document.querySelectorAll('[data-sync], .teaser-pair, .slider-row, video.method-video')];
  }
  function groupName(root, index) {
    return root.dataset.sync || (root.matches('.teaser-pair') ? 'teaser' : root.matches('.slider-row') ? 'correction-slider' : `method-${index}`);
  }
  function videoState(video) {
    const quality = video.getVideoPlaybackQuality?.();
    return {src:video.currentSrc,plannedSrc:video.dataset.src || video.querySelector('source')?.dataset.src,
      paused:video.paused,ready:video.readyState,network:video.networkState,seeking:video.seeking,time:video.currentTime,
      duration:Number.isFinite(video.duration)?video.duration:null,width:video.videoWidth,height:video.videoHeight,
      quality:quality?{totalVideoFrames:quality.totalVideoFrames,droppedVideoFrames:quality.droppedVideoFrames,
        corruptedVideoFrames:quality.corruptedVideoFrames,creationTime:quality.creationTime}:null,
      error:video.error?{code:video.error.code,message:video.error.message}:null,
      frameCallback:videoFrames.get(video) || null};
  }
  function groupState(root, index) {
    const rect = root.getBoundingClientRect();
    const videos = root.tagName === 'VIDEO' ? [root] : [...root.querySelectorAll('video')];
    const panels = [...root.querySelectorAll('canvas.media-panel')].map(canvas => panelFrames.get(canvas) || null);
    const readyPanels = panels.filter(Boolean);
    const ids = new Set(readyPanels.map(panel=>panel.callbackId));
    const times = readyPanels.map(panel=>panel.mediaTime);
    const independentTimes = videos.filter(video=>video.readyState>=2).map(video=>video.currentTime);
    return {name:groupName(root,index),mode:root.dataset.mediaMode || 'original',
      visible:rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth,
      rectangle:{top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},
      drawnFrames:Number(root.dataset.mediaFrame || 0),videos:videos.map(videoState),panels,
      allPanelsShareCallback:panels.length>0&&readyPanels.length===panels.length&&ids.size===1&&!ids.has(null),
      panelMediaTimeSpread:times.length?Math.max(...times)-Math.min(...times):null,
      independentMediaTimeSpread:independentTimes.length>1?Math.max(...independentTimes)-Math.min(...independentTimes):null};
  }
  function intervalStats(times) {
    const intervals = times.slice(1).map((time,index)=>time-times[index]).sort((a,b)=>a-b);
    return {updates:viewerUpdates,windowUpdates:times.length,
      meanMs:intervals.length?intervals.reduce((sum,value)=>sum+value,0)/intervals.length:null,
      medianMs:intervals.length?intervals[Math.floor(intervals.length/2)]:null,
      p95Ms:intervals.length?intervals[Math.min(intervals.length-1,Math.floor(intervals.length*.95))]:null};
  }
  function sample() {
    const time = performance.now();
    // Ledger polling is not part of the historical resource total. The injected
    // JS remains in that legacy total; site totals exclude all diagnostics.
    const resources = performance.getEntriesByType('resource').filter(entry=>pathname(entry.name)!=='/__measure-ledger')
      .map(entry=>({name:pathname(entry.name),origin:new URL(entry.name).origin,bytes:entry.transferSize,
        encoded:entry.encodedBodySize,duration:entry.duration,start:entry.startTime,end:entry.responseEnd,
        initiator:entry.initiatorType,diagnostic:diagnostic(pathname(entry.name))}));
    const site = resources.filter(entry=>!entry.diagnostic);
    return {time,afterDclMs:dclTime===null?null:time-dclTime,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,
      hidden:document.hidden,requests:resources.length,transferBytes:resources.reduce((sum,entry)=>sum+entry.bytes,0),
      siteRequests:site.length,siteTransferBytes:site.reduce((sum,entry)=>sum+entry.bytes,0),
      completedLocalBodyBytes:site.filter(entry=>entry.origin===location.origin).reduce((sum,entry)=>sum+entry.encoded,0),
      resources,videos:[...document.querySelectorAll('video')].map(videoState),groups:groupRoots().map(groupState),
      draws,rafCallbacks,longTasks:longTasks.map(task=>({...task})),errors:[...errors],heap:performance.memory?.usedJSHeapSize,
      frame:document.getElementById('frame')?.textContent,viewerFrameTiming:intervalStats(viewerFrames),
      sections:[...document.querySelectorAll('body > section')].map(section=>({name:section.querySelector('h2,h1')?.textContent,
        top:section.offsetTop,height:section.offsetHeight})),
      serverLedger:latestLedger,ledgerAgeMs:latestLedger?time-latestLedger.clientReceivedAtMs:null};
  }
  async function readLedger(detail = false) {
    if (!runId) return null;
    const requestedAt = performance.now();
    try {
      const response = await fetch(`/__measure-ledger?run=${encodeURIComponent(runId)}&detail=${detail?1:0}`, {cache:'no-store'});
      if (!response.ok) throw new Error(`ledger HTTP ${response.status}`);
      const ledger = await response.json();
      ledger.clientRequestedAtMs=requestedAt;
      ledger.clientReceivedAtMs=performance.now();
      latestLedger=ledger;
      ledgerFailure=null;
      return ledger;
    } catch (error) { ledgerFailure=String(error); return null; }
  }
  function publish() {
    let output = document.getElementById('__performance');
    if (!output) { output=document.createElement('script'); output.id='__performance'; output.type='application/json'; document.body.appendChild(output); }
    output.textContent=JSON.stringify({runId,dclTime,samples,current:sample(),visibilityEvents,actions,mediaEvents,ledgerFailure,
      definitions:{samples:'5s/15s after DOMContentLoaded, with actual timestamp/lateness; keep tab foreground and leave viewport/scroll untouched for initial-load runs.',
        resourceTiming:'Completed response transferSize includes headers. Legacy requests/transferBytes exclude HTML and ledger polling, but include injected measurement JS. Canonical site totals exclude all measurement endpoints.',
        serverLedger:'Local body bytes successfully written to sockets, including in-flight/aborted ranges. No headers, HTML or diagnostic endpoints in site totals. Client requested/received timestamps bound snapshot delay; OS queues can precede browser receipt.',
        synchronization:'Same callback/mediaTime copied to all composite canvases; verifies shared decoded frame, not semantic content alignment within the encoded atlas.',
        controls:'Diagnostic seek/play/pause actions override selected media for inspection and are logged; do not use during untouched initial-load runs.',
        network:'Preview throttling affects local origins only. Use separate ports for concurrent test pages and a unique run=LABEL for each intentional run; duplicate HTML fetches/reloads with the same label reuse its ledger.'}});
    output.dataset.ready=String(samples.length>0);
    output.dataset.run=runId || 'legacy-server';
  }
  async function capture(delay) {
    const captured = sample();
    captured.scheduledAfterDclMs=delay;
    captured.latenessMs=Math.max(0,captured.afterDclMs-delay);
    captured.ledgerPending=Boolean(runId);
    samples.push(captured);
    if (runId) {
      captured.serverLedger=await readLedger(true);
      captured.ledgerPending=false;
      captured.ledgerAgeMs=null;
      captured.ledgerSnapshotLagMs=captured.serverLedger?captured.serverLedger.clientReceivedAtMs-captured.time:null;
    }
    publish();
  }

  function controls() {
    const panel=document.createElement('details'); panel.id='__measure-controls';
    panel.style.cssText='position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#fff;color:#222;padding:8px;border:1px solid #777;border-radius:6px;font:12px sans-serif;max-width:350px;box-shadow:0 2px 8px #0003';
    const summary=document.createElement('summary'); summary.textContent='Measurement tools'; panel.appendChild(summary);
    const selectLabel=document.createElement('label'); selectLabel.textContent='Video group ';
    const select=document.createElement('select'); select.id='__measure-group'; select.setAttribute('aria-label','Measurement video group');
    groupRoots().forEach((root,index)=>{ const option=document.createElement('option'); option.value=String(index); option.textContent=groupName(root,index); select.appendChild(option); });
    selectLabel.appendChild(select); panel.appendChild(selectLabel);
    const timeLabel=document.createElement('label'); timeLabel.textContent=' Time (seconds) ';
    const time=document.createElement('input'); time.id='__measure-time'; time.type='number'; time.min='0'; time.step='0.1'; time.value='0'; time.style.width='70px'; time.setAttribute('aria-label','Measurement seek time');
    timeLabel.appendChild(time); panel.appendChild(timeLabel);
    const status=document.createElement('output'); status.id='__measure-control-status'; status.style.display='block';
    const chosen=()=>groupRoots()[Number(select.value)];
    const selectedVideos=()=>{ const root=chosen(); return root.tagName==='VIDEO'?[root]:[...root.querySelectorAll('video')]; };
    const button=(label,action)=>{
      const element=document.createElement('button'); element.type='button'; element.textContent=label; element.style.margin='5px 3px 0 0';
      element.addEventListener('click',async()=>{
        const entry={time:performance.now(),action:label,group:groupName(chosen(),Number(select.value)),seekTime:Number(time.value)};
        boundedPush(actions,entry);
        try { await action(); status.textContent=`${label}: done`; } catch(error) { entry.error=String(error); status.textContent=String(error); }
        publish();
      });
      panel.appendChild(element);
    };
    button('Show group',()=>chosen().scrollIntoView({block:'center',behavior:'instant'}));
    button('Seek selected',()=>{
      const value=Number(time.value), videos=selectedVideos();
      if (!Number.isFinite(value)||value<0) throw new Error('Enter a nonnegative seek time.');
      if (videos.some(video=>video.readyState<1)) throw new Error('Show the group and wait for video metadata before seeking.');
      videos.forEach(video=>{ video.currentTime=Math.min(value,Math.max(0,video.duration-0.001)); });
    });
    button('Play selected',async()=>{ await Promise.all(selectedVideos().map(video=>video.play())); });
    button('Pause selected',()=>selectedVideos().forEach(video=>video.pause()));
    button('Capture snapshot',async()=>{ const captured=sample(); captured.manual=true; captured.serverLedger=await readLedger(true); samples.push(captured); });
    panel.appendChild(status); document.body.appendChild(panel);
  }
  addEventListener('DOMContentLoaded',()=>{
    dclTime=performance.now();
    const frame=document.getElementById('frame');
    if (frame) new MutationObserver(()=>{ viewerUpdates++; boundedPush(viewerFrames,performance.now(),120); })
      .observe(frame,{childList:true,characterData:true,subtree:true});
    controls();
    publish();
    setInterval(async()=>{ await readLedger(); publish(); },1000);
    for (const delay of [5000,15000]) setTimeout(()=>capture(delay),delay);
  });
})();
