/* Viewport-driven playback for ReLift's static media.
 * A composite has one decoder and one frame callback; its original panels are
 * drawn into the existing grid cells, keeping labels, gutters and mobile wrap.
 * Original video elements stay available as a fallback for unsupported/failed
 * composite playback. The interactive 3D viewer manages its own media.
 */
(() => {
  'use strict';
  const roots = document.querySelectorAll('[data-sync], .teaser-pair, .slider-row, video.method-video');
  const groups = [];
  const groupForRoot = new Map();
  const expectedPauses = new WeakMap();
  const supportsComposite = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  function sources(video) {
    let changed = false;
    if (video.dataset.src && !video.hasAttribute('src')) {
      video.src = video.dataset.src;
      changed = true;
    }
    video.querySelectorAll('source[data-src]').forEach(source => {
      if (!source.hasAttribute('src')) {
        source.src = source.dataset.src;
        changed = true;
      }
    });
    return changed;
  }

  function active(group) {
    return group.visible && !document.hidden;
  }

  function media(group) {
    return group.decoder ? [group.decoder] : group.originals.filter(video => !video.closest('.cmp:not(.active)'));
  }

  function cancelFrame(group) {
    if (group.frameRequest != null && group.decoder) {
      group.decoder.cancelVideoFrameCallback(group.frameRequest);
      group.frameRequest = null;
    }
  }

  function pauseVideo(video) {
    // Media events are queued asynchronously, so track the expected event
    // instead of using a temporary boolean around pause().
    if (!video.paused) {
      expectedPauses.set(video, (expectedPauses.get(video) || 0) + 1);
      video.pause();
    }
  }

  function pause(group) {
    group.generation++;
    group.starting = false;
    group.running = false;
    cancelFrame(group);
    media(group).forEach(pauseVideo);
  }

  function draw(group) {
    const video = group.decoder;
    if (!video || video.readyState < 2 || !active(group)) return;
    const width = group.panelWidth, height = group.panelHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    try {
      group.panels.forEach((panel, i) => {
        const canvas = panel.canvas;
        if (group.sizeDirty) {
          const pixels = Math.max(1, Math.min(panel.width, Math.round(canvas.getBoundingClientRect().width * ratio)));
          const rows = Math.max(1, Math.round(pixels * panel.height / panel.width));
          if (canvas.width !== pixels || canvas.height !== rows) { canvas.width = pixels; canvas.height = rows; }
        }
        panel.context.drawImage(video, (i % group.columns) * width, Math.floor(i / group.columns) * height,
          panel.width, panel.height, 0, 0, canvas.width, canvas.height);
      });
      group.sizeDirty = false;
      group.root.dataset.mediaFrame = String(group.drawnFrames++);
    } catch (_) {
      fallback(group);
    }
  }

  function scheduleFrame(group) {
    if (!group.decoder || group.frameRequest != null || !active(group) || !group.running) return;
    group.frameRequest = group.decoder.requestVideoFrameCallback(() => {
      group.frameRequest = null;
      if (!active(group) || !group.running) return;
      draw(group);
      scheduleFrame(group);
    });
  }

  function showPosters(group) {
    group.originals.forEach((video, i) => {
      const poster = video.dataset.poster || video.getAttribute('poster');
      if (!poster) return;
      if (group.decoder) {
        // Assign only near the viewport so the poster collection is lazy too.
        group.panels[i].canvas.style.backgroundImage = `url(${JSON.stringify(poster)})`;
      } else if (!video.hasAttribute('poster')) {
        video.poster = poster;
      }
    });
  }

  function preload(group) {
    if (document.hidden || !group.near) return;
    if (!group.compositeAttempted) {
      group.compositeAttempted = true;
      composite(group);
    }
    showPosters(group);
    media(group).forEach(video => {
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      if (sources(video)) video.load();
    });
  }

  function synchronize(group) {
    if (group.decoder || !group.running || !active(group)) return;
    const videos = media(group), lead = videos[0];
    if (!lead || lead.seeking) return;
    videos.slice(1).forEach(video => {
      if (video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - lead.currentTime) > 0.08) {
        video.currentTime = lead.currentTime;
      }
    });
  }

  function resume(group) {
    if (!active(group)) { pause(group); return; }
    preload(group);
    if (group.userPaused || group.starting || group.running) return;
    const videos = media(group);
    // Wait for the whole group. Never start just the ready subset on a slow link.
    if (!videos.length || videos.some(video => video.readyState < 2 || video.seeking || video.error)) return;
    const generation = ++group.generation;
    group.starting = true;
    const time = videos[0].currentTime;
    videos.slice(1).forEach(video => {
      if (Math.abs(video.currentTime - time) > 0.04) video.currentTime = time;
    });
    // Let a correction seek finish before starting all members together.
    if (videos.some(video => video.seeking)) { group.starting = false; return; }
    group.running = true;
    draw(group);
    scheduleFrame(group);
    Promise.allSettled(videos.map(video => video.play())).then(results => {
      if (group.generation !== generation) {
        if (!active(group)) videos.forEach(pauseVideo);
        return;
      }
      group.starting = false;
      if (!active(group) || results.some(result => result.status === 'rejected')) {
        pause(group);
        // A pointer interaction inside this group retries a blocked autoplay.
      }
    });
  }

  function bindVideo(group, video) {
    video.addEventListener('pause', () => {
      const expected = expectedPauses.get(video) || 0;
      if (expected) { expectedPauses.set(video, expected - 1); return; }
      if (video.controls && group.originals.length === 1) {
        group.userPaused = true;
        group.generation++;
        group.starting = false;
        group.running = false;
      }
    });
    video.addEventListener('play', () => {
      if (!video.controls || group.originals.length !== 1) return;
      group.userPaused = false;
      if (!active(group)) { pause(group); return; }
      group.running = true;
    });
    const ready = () => {
      if (video === group.decoder && video.readyState >= 2 &&
          (video.videoWidth !== group.panelWidth * group.columns ||
           video.videoHeight !== group.panelHeight * Math.ceil(group.originals.length / group.columns))) {
        fallback(group);
        return;
      }
      if (media(group).includes(video)) resume(group);
    };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('seeked', ready);
    video.addEventListener('waiting', () => {
      if (!group.decoder && group.running && media(group).includes(video)) pause(group);
    });
    video.addEventListener('error', () => {
      if (video === group.decoder) fallback(group);
      else if (media(group).includes(video)) pause(group);
    });
  }

  function fallback(group) {
    if (!group.decoder) return;
    pause(group);
    const decoder = group.decoder;
    group.decoder = null;
    decoder.removeAttribute('src');
    decoder.load();
    decoder.remove();
    group.panels.forEach((panel, i) => panel.canvas.replaceWith(group.originals[i]));
    group.panels = [];
    group.root.dataset.mediaMode = 'original';
    group.root.removeAttribute('data-media-frame');
    preload(group);
    resume(group);
  }

  function composite(group) {
    const root = group.root;
    const width = Number(root.dataset.panelWidth), height = Number(root.dataset.panelHeight);
    const columns = Number(root.dataset.atlasColumns);
    if (!root.dataset.compositeSrc || !supportsComposite ||
        ![width, height, columns].every(value => Number.isInteger(value) && value > 0)) return;
    // Atlas cells may contain differently sized source panels, padded at the
    // right/bottom. Crop only native content and preserve each source's ratio.
    const dimensions = group.originals.map(video => ({
      width: video.hasAttribute('width') ? Number(video.getAttribute('width')) : width,
      height: video.hasAttribute('height') ? Number(video.getAttribute('height')) : height,
    }));
    if (dimensions.some(size => !Number.isInteger(size.width) || size.width <= 0 || size.width > width ||
        !Number.isInteger(size.height) || size.height <= 0 || size.height > height)) return;
    const panels = group.originals.map((video, i) => {
      const size = dimensions[i];
      const canvas = document.createElement('canvas');
      canvas.className = `${video.className} media-panel`;
      canvas.style.cssText = video.style.cssText;
      canvas.style.aspectRatio = `${size.width} / ${size.height}`;
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', video.getAttribute('aria-label') || video.parentElement.querySelector('.video-title')?.textContent || 'Video panel');
      return {canvas, context: canvas.getContext('2d'), width: size.width, height: size.height};
    });
    if (panels.some(panel => !panel.context)) return;
    const decoder = document.createElement('video');
    decoder.className = 'media-decoder';
    decoder.preload = 'none';
    decoder.muted = true;
    decoder.loop = true;
    decoder.playsInline = true;
    decoder.setAttribute('muted', '');
    decoder.setAttribute('playsinline', '');
    decoder.setAttribute('aria-hidden', 'true');
    decoder.tabIndex = -1;
    decoder.dataset.src = root.dataset.compositeSrc;
    group.originals.forEach((video, i) => { pauseVideo(video); video.replaceWith(panels[i].canvas); });
    root.appendChild(decoder);
    Object.assign(group, {decoder, panels, panelWidth: width, panelHeight: height, columns});
    root.dataset.mediaMode = 'composite';
    bindVideo(group, decoder);
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => { group.sizeDirty = true; draw(group); }).observe(root);
    }
  }

  roots.forEach(root => {
    const originals = root.tagName === 'VIDEO' ? [root] : Array.from(root.querySelectorAll('video'));
    if (!originals.length) return;
    const group = {root, originals, decoder: null, panels: [], near: false, visible: false,
      generation: 0, starting: false, running: false, frameRequest: null, drawnFrames: 0, sizeDirty: true, userPaused: false, compositeAttempted: false};
    groups.push(group);
    groupForRoot.set(root, group);
    originals.forEach(video => {
      video.autoplay = false;
      video.preload = 'none';
      pauseVideo(video);
      bindVideo(group, video);
    });
    originals[0].addEventListener('timeupdate', () => synchronize(group));
    root.dataset.mediaMode = 'original';
    root.addEventListener('pointerdown', () => { if (active(group)) resume(group); });
  });

  if ('IntersectionObserver' in window) {
    const nearObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      const group = groupForRoot.get(entry.target);
      group.near = entry.isIntersecting;
      if (group.near) preload(group);
    }), {rootMargin: '240px 0px'});
    const visibleObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      const group = groupForRoot.get(entry.target);
      group.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (group.visible) { group.near = true; resume(group); }
      else pause(group);
    }));
    groups.forEach(group => { nearObserver.observe(group.root); visibleObserver.observe(group.root); });
  } else {
    // Preserve lazy behavior on browsers without IntersectionObserver.
    let pending = false;
    const scan = () => {
      pending = false;
      groups.forEach(group => {
        const r = group.root.getBoundingClientRect();
        group.near = r.bottom > -240 && r.top < innerHeight + 240;
        group.visible = r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0;
        preload(group);
        resume(group);
      });
    };
    window.addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(scan); } }, {passive: true});
    window.addEventListener('resize', scan);
    scan();
  }
  document.addEventListener('visibilitychange', () => groups.forEach(group => {
    if (document.hidden) pause(group);
    else { preload(group); resume(group); }
  }));
  window.addEventListener('pagehide', () => groups.forEach(pause));
  window.addEventListener('pageshow', () => groups.forEach(resume));
  window.addEventListener('resize', () => groups.forEach(group => { group.sizeDirty = true; if (active(group)) draw(group); }));
})();
