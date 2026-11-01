/* Load the interactive viewer on approach; only render while its stage is visible. */
(() => {
  'use strict';
  function buildTrajectoryBuffers(tr, cols, T, Q) {
    // Count valid segments first, then write directly into the final GPU buffers.
    // This avoids three growable JS arrays and a second copy into typed arrays.
    let vertices = 0;
    const segStart = new Uint32Array(T);
    for (let t = 0; t < T - 1; t++) {
      for (let q = 0; q < Q; q++) {
        const a = (t * Q + q) * 3, b = ((t + 1) * Q + q) * 3;
        if (isFinite(tr[a]) && isFinite(tr[b])) vertices += 2;
      }
      segStart[t + 1] = vertices;
    }
    const pos = new Float32Array(vertices * 3), col = new Float32Array(vertices * 3), at = new Float32Array(vertices);
    let vertex = 0;
    for (let t = 0; t < T - 1; t++) {
      for (let q = 0; q < Q; q++) {
        const a = (t * Q + q) * 3, b = ((t + 1) * Q + q) * 3;
        if (!isFinite(tr[a]) || !isFinite(tr[b])) continue;
        for (let k = 0; k < 3; k++) {
          pos[vertex * 3 + k] = tr[a + k]; pos[(vertex + 1) * 3 + k] = tr[b + k];
          col[vertex * 3 + k] = col[(vertex + 1) * 3 + k] = cols[q][k];
        }
        at[vertex] = at[vertex + 1] = t + 1;
        vertex += 2;
      }
    }
    return {pos, col, at, segStart};
  }

  const WIDEN = {forest: 1.2};
  const DYN_SIZE = {'swing-tire': 3.2, swing: 3.2, spin: 4.5, 'motocross-bumps': 3.2};
  const TRACK_HEAD_SIZE = 2.4;
  const FRAMING_SCALE = {forest: 0.9, 'motocross-bumps': 0.9};

  // Cloud sizes are CSS-pixel targets, with scene-specific moving-point sizes.
  // Three.js applies renderer DPR itself; cloud materials must not apply it again.
  function cloudPointSizes(name) {
    return {background: 2.7, dynamic: DYN_SIZE[name] || 2.4};
  }
  function trackHeadSize(name) {
    return TRACK_HEAD_SIZE * (name === 'running' ? 0.6 : 1);
  }
  function rendererPixelRatio(value) {
    return Math.min(Number.isFinite(value) && value > 0 ? value : 1, 2);
  }
  function framingFov(name, sourceFov) {
    const original = Math.min(150, sourceFov * (WIDEN[name] || 1));
    if (!FRAMING_SCALE[name]) return original;
    // Widen the view without moving the camera behind background surfaces.
    return Math.min(150, 2 * Math.atan(Math.tan(original * Math.PI / 360) /
      FRAMING_SCALE[name]) * 180 / Math.PI);
  }

  // Allow numerical and presentation settings to be checked without a GPU.
  if (typeof module === 'object' && module.exports) {
    module.exports = {buildTrajectoryBuffers, cloudPointSizes, rendererPixelRatio, framingFov};
    return;
  }

  const stage = document.getElementById('stage');
  const statusEl = document.getElementById('status');
  const box = document.getElementById('scenes');
  const sl = document.getElementById('slider');
  const playButton = document.getElementById('play');
  const tailButton = document.getElementById('tail');
  const NAMES = ['cartwheel', 'running', 'swing-tire', 'swing', 'spin', 'forest', 'tennis', 'motocross-bumps', 'drift-turn'];
  // Native-resolution CRF21 sidecars validated in the media manifest.
  const COMPRESSED = new Set(['cartwheel', 'spin', 'swing-tire', 'swing', 'tennis']);
  const PORTRAIT = new Set(['cartwheel', 'running']), P34 = new Set(['spin']);
  const TAIL = 20;
  const FOLLOW = {running: 6};
  const PULL = {cartwheel: 1.05, forest: 1.7, tennis: 1.75, 'motocross-bumps': 2.0};
  let renderer, camera, controls, scene, f16, rendererPromise;
  let densityQuery;
  let D, M, T, Q, tr, segStart, dyn, lines, heads, med, lineMat;
  let cen = null, size = 1, follow = 0, cenAt = 0, cur = '';
  let frame = 0, playing = true, fullTail = false, acc = 0, last = performance.now();
  let vid = null, want = 'cartwheel', switching = false, failed = false, holdSince = 0;
  let visible = false, near = false, animation = 0, selection = 0;
  const scripts = new Map();
  const videos = new Map();

  function script(src) {
    if (scripts.has(src)) return scripts.get(src);
    const promise = new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = src;
      element.onload = resolve;
      element.onerror = () => {
        scripts.delete(src);
        element.remove();
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(element);
    });
    scripts.set(src, promise);
    return promise;
  }

  function ensureRenderer() {
    if (rendererPromise) return rendererPromise;
    rendererPromise = (async () => {
      if (!window.THREE) await script('./static/js/three.min.js');
      if (!THREE.OrbitControls) await script('./static/js/OrbitControls.js');
      renderer = new THREE.WebGLRenderer({antialias: true});
      renderer.setPixelRatio(rendererPixelRatio(window.devicePixelRatio));
      renderer.setClearColor(0xffffff, 1);
      stage.appendChild(renderer.domElement);
      camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.001, 1000);
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.enableZoom = false;
      controls.enabled = visible && !document.hidden;
      scene = new THREE.Scene();
      f16 = new Float32Array(65536);
      for (let h = 0; h < 65536; h++) {
        const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
        f16[h] = e === 0 ? s * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024);
      }
      new ResizeObserver(resize).observe(stage);
      window.addEventListener('resize', resize);
      watchDisplayDensity();
      resize();
    })().catch(error => {
      rendererPromise = null;
      throw error;
    });
    return rendererPromise;
  }

  function watchDisplayDensity() {
    if (!window.matchMedia) return;
    if (densityQuery?.removeEventListener) densityQuery.removeEventListener('change', displayDensityChanged);
    else densityQuery?.removeListener?.(displayDensityChanged);
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    if (densityQuery.addEventListener) densityQuery.addEventListener('change', displayDensityChanged);
    else densityQuery.addListener?.(displayDensityChanged);
  }
  function displayDensityChanged() {
    resize();
    watchDisplayDensity();
  }
  function resize() {
    if (!renderer) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const ratio = rendererPixelRatio(window.devicePixelRatio);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    // Retain head density scaling and the selected scene's size adjustment.
    if (heads) heads.material.size = trackHeadSize(cur) * ratio;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function b64buf(s) {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function halfs(s) {
    const u = new Uint16Array(b64buf(s)), o = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) o[i] = f16[u[i]];
    return o;
  }

  // Geometry, colors and timing stay unchanged; presentation is tuned separately.
  function jet(x) { const c = v => Math.min(Math.max(v, 0), 1); return [c(1.5 - Math.abs(4 * x - 3)), c(1.5 - Math.abs(4 * x - 2)), c(1.5 - Math.abs(4 * x - 1))]; }
  const pm = size => new THREE.PointsMaterial({size, vertexColors: true, sizeAttenuation: false});
  function load(name) {
    D = window.SUPP && window.SUPP[name];
    if (!D) { statusEl.style.display = ""; statusEl.textContent = "Could not load the demo data."; return false; }
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene = new THREE.Scene();
    M = D.meta; T = M.T; Q = M.Q;
    const pointSizes = cloudPointSizes(name);
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(halfs(D.sxyz), 3)); sg.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(b64buf(D.srgb)), 3, true));
    scene.add(new THREE.Points(sg, pm(pointSizes.background)));
    const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(halfs(D.dxyz), 3)); dg.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(b64buf(D.drgb)), 3, true));
    dyn = new THREE.Points(dg, pm(pointSizes.dynamic)); scene.add(dyn);
    tr = halfs(D.tracks); const cols = []; for (let q = 0; q < Q; q++) cols.push(jet(Q > 1 ? q / (Q - 1) : 0));
    const {pos, col, at, segStart: starts} = buildTrajectoryBuffers(tr, cols, T, Q);
    segStart = starts;
    lineMat = new THREE.ShaderMaterial({uniforms: {uNow: {value: 0}, uTail: {value: TAIL}},
      vertexShader: "attribute float aT; attribute vec3 color; varying vec3 vC; varying float vT; void main(){vC=color; vT=aT; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform float uNow; uniform float uTail; varying vec3 vC; varying float vT; void main(){ float age=uNow-vT; if(age<=0.0||age>uTail+0.5) discard; float a=max(1.0-0.9*(age-1.0)/(0.99*uTail),0.1); gl_FragColor=vec4(vC,a);}",
      transparent: true, depthWrite: false});
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); lg.setAttribute("color", new THREE.BufferAttribute(col, 3)); lg.setAttribute("aT", new THREE.BufferAttribute(at, 1));
    lines = new THREE.LineSegments(lg, lineMat); lines.frustumCulled = false; scene.add(lines);
    const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Q * 3), 3));
    const hc = new Float32Array(Q * 3); for (let q = 0; q < Q; q++) hc.set(cols[q], q * 3); hg.setAttribute("color", new THREE.BufferAttribute(hc, 3));
    heads = new THREE.Points(hg, pm(trackHeadSize(name) * rendererPixelRatio(window.devicePixelRatio))); heads.frustumCulled = false; scene.add(heads);
    med = [0, 1, 2].map(k => { const v = []; for (let i = k; i < tr.length; i += 3) if (isFinite(tr[i])) v.push(tr[i]); v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; });
    cur = name; follow = FOLLOW[name] || 0; cen = null;
    if (follow) {                                                      // per-frame subject centre (median of the tracks), smoothed over +-6 frames
      const raw = []; for (let t = 0; t < T; t++) raw.push([0, 1, 2].map(k => { const v = []; for (let q = 0; q < Q; q++) { const x = tr[(t * Q + q) * 3 + k]; if (isFinite(x)) v.push(x); }
        v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; }));
      for (let t = 0; t < T; t++) if (!isFinite(raw[t][0])) raw[t] = (raw[t - 1] || raw.find(r => isFinite(r[0]))).slice();
      cen = raw.map((_, t) => [0, 1, 2].map(k => { let s = 0, n = 0; for (let u = Math.max(0, t - 6); u <= Math.min(T - 1, t + 6); u++) { s += raw[u][k]; n++; } return s / n; }));
      const ext = []; for (let t = 0; t < T; t += Math.max(1, T >> 4)) { const d = []; for (let q = 0; q < Q; q++) { const a = (t * Q + q) * 3; if (isFinite(tr[a]))
        d.push(Math.hypot(tr[a] - raw[t][0], tr[a + 1] - raw[t][1], tr[a + 2] - raw[t][2])); } d.sort((a, b) => a - b); if (d.length) ext.push(d[Math.floor(0.95 * (d.length - 1))]); }
      ext.sort((a, b) => a - b); size = 2 * (ext[ext.length >> 1] || 1);
    }
    sl.max = T - 1; statusEl.style.display = "none"; return true;
  }
  function setFrame(t) {
    frame = Math.max(0, Math.min(T - 1, t)); const o = M.dyn_offsets; dyn.geometry.setDrawRange(o[frame], o[frame + 1] - o[frame]);
    const tail = fullTail ? T : TAIL; lineMat.uniforms.uNow.value = frame; lineMat.uniforms.uTail.value = tail;
    const s0 = segStart[Math.max(0, frame - tail)]; lines.geometry.setDrawRange(s0, segStart[frame] - s0);
    const hp = heads.geometry.attributes.position.array;
    for (let q = 0; q < Q; q++) { const a = (frame * Q + q) * 3, ok = isFinite(tr[a]); hp[q * 3] = ok ? tr[a] : 1e9; hp[q * 3 + 1] = ok ? tr[a + 1] : 1e9; hp[q * 3 + 2] = ok ? tr[a + 2] : 1e9; }
    if (follow) { const a = cen[cenAt], b = cen[frame]; const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]); camera.position.add(d); controls.target.add(d); cenAt = frame; }
    heads.geometry.attributes.position.needsUpdate = true; sl.value = frame; document.getElementById("frame").textContent = `frame ${frame + 1} / ${T}`;
  }
  function resetView() {
    const c = M.camera; let tg = med, P = PULL[cur] || 1.3;
    if (follow) { cenAt = Math.min(frame, T - 1); tg = cen[cenAt]; P = follow * size / Math.hypot(...[0, 1, 2].map(i => c.position[i] - c.target[i])); }
    const p = tg.map((v, i) => v + (c.position[i] - c.target[i]) * P);
    camera.fov = framingFov(cur, c.fov); camera.position.set(...p); camera.up.set(...c.up); controls.target.set(...tg); camera.updateProjectionMatrix(); controls.update();
  }

  function hydrate(video) {
    if (video.hasAttribute('src')) return;
    video.preload = 'auto';
    video.src = video.dataset.src;
    video.load();
  }
  function reset(video) {
    video.pause();
    if (video.readyState >= 1) {
      try { video.currentTime = 0; } catch (_) {}
    }
  }
  function playVid() {
    if (!vid || !D || switching || !playing || !visible || document.hidden) return;
    vid.play().catch(() => {});
  }
  function seekVid(t) {
    if (M && vid && vid.readyState >= 1) {
      try { vid.currentTime = (t + 0.5) / M.fps; } catch (_) {}
    }
  }
  function vidOk() {
    return vid && vid.readyState >= 2 && !vid.paused && Math.abs(vid.duration * M.fps - T) < 1.5;
  }
  function syncActivity() {
    const active = visible && !document.hidden;
    if (controls) controls.enabled = active;
    last = performance.now();
    holdSince = 0;
    if (!active) {
      cancelAnimationFrame(animation);
      animation = 0;
      videos.forEach(video => video.pause());
      return;
    }
    playVid();
    if (D && !animation) animation = requestAnimationFrame(loop);
  }
  function loop(now) {
    animation = 0;
    if (!visible || document.hidden || !D) return;
    controls.update();
    const lag = playing && vid && (vid.seeking || vid.readyState < 2);
    holdSince = lag ? (holdSince || now) : 0;
    if (!switching && !(lag && now - holdSince < 3000)) {
      if (playing && vidOk()) {
        const f = Math.min(T - 1, Math.floor(vid.currentTime * M.fps));
        if (f !== frame) setFrame(f);
      } else if (playing) {
        acc += (now - last) / 1000;
        const st = 1 / M.fps;
        if (acc >= st) {
          const n = Math.floor(acc / st);
          acc -= n * st;
          setFrame((frame + n) % T);
          seekVid(frame);
        }
      }
    }
    last = now;
    renderer.render(scene, camera);
    animation = requestAnimationFrame(loop);
  }

  function ready(video) {
    if (video.readyState >= 2 && !video.seeking) return Promise.resolve();
    return new Promise(resolve => {
      let timeout;
      function finish() {
        clearTimeout(timeout);
        video.removeEventListener('loadeddata', check);
        video.removeEventListener('seeked', check);
        video.removeEventListener('error', finish);
        resolve();
      }
      function check() { if (video.readyState >= 2 && !video.seeking) finish(); }
      video.addEventListener('loadeddata', check);
      video.addEventListener('seeked', check);
      video.addEventListener('error', finish);
      // Keep the existing viewer's fallback for a missing/unplayable input video.
      timeout = setTimeout(finish, 7000);
      check();
    });
  }

  async function select(name) {
    const ticket = ++selection;
    want = name;
    switching = true;
    failed = false;
    if (vid) reset(vid);
    vid = videos.get(name);
    reset(vid);
    hydrate(vid);
    const chosenVideo = vid;
    statusEl.style.display = '';
    statusEl.textContent = 'Loading 3D…';
    try {
      await ensureRenderer();
      if (ticket !== selection) return;
      if (!window.SUPP?.[name]) await script(`./static/data/${name}.js`);
      if (ticket !== selection) return;
      if (!load(name)) throw new Error(`Missing scene data for ${name}`);
      resetView();
      setFrame(0);
      statusEl.style.display = '';
      statusEl.textContent = 'Loading video…';
      syncActivity();
      await ready(chosenVideo);
      if (ticket !== selection) return;
      switching = false;
      acc = 0;
      if (chosenVideo.currentTime > 0.05) seekVid(0);
      statusEl.style.display = 'none';
      syncActivity();
    } catch (error) {
      if (ticket !== selection) return;
      // Keep the previous scene still rather than pairing it with the new clip.
      switching = true;
      failed = true;
      statusEl.style.display = '';
      statusEl.textContent = 'Could not load the demo. Select a clip to retry.';
      console.error(error);
    }
  }

  playButton.addEventListener('click', () => {
    playing = !playing;
    playButton.textContent = playing ? 'Pause' : 'Play';
    if (playing) { if (D && !switching) seekVid(frame); playVid(); }
    else if (vid) vid.pause();
  });
  sl.addEventListener('input', event => {
    playing = false;
    playButton.textContent = 'Play';
    if (vid) vid.pause();
    if (D && !switching) { setFrame(+event.target.value); seekVid(frame); }
  });
  tailButton.addEventListener('click', () => {
    fullTail = !fullTail;
    tailButton.classList.toggle('is-active', fullTail);
    tailButton.setAttribute('aria-pressed', String(fullTail));
    if (D && !switching) setFrame(frame);
  });
  document.getElementById('reset').addEventListener('click', () => {
    if (D && !switching) resetView();
  });

  const posterObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const video = entry.target.querySelector('video');
      video.poster = video.dataset.poster;
      posterObserver.unobserve(entry.target);
    });
  }, {rootMargin: '160px 0px'}) : null;
  NAMES.forEach(name => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'demo-thumb' + (PORTRAIT.has(name) ? ' portrait' : P34.has(name) ? ' portrait p34' : '') + (name === want ? ' active' : '');
    button.setAttribute('aria-label', `Show the ${name} demo`);
    button.setAttribute('aria-pressed', String(name === want));
    const video = document.createElement('video');
    video.dataset.src = `./static/videos/${COMPRESSED.has(name) ? 'optimized/individual/' : ''}demo_${name}.mp4`;
    video.dataset.poster = `./static/images/posters/demo_${name}.jpg`;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.tabIndex = -1;
    button.appendChild(video);
    videos.set(name, video);
    button.addEventListener('mouseenter', () => {
      if (video !== vid && !document.hidden) {
        hydrate(video);
        video.play().catch(() => {});
      }
    });
    button.addEventListener('mouseleave', () => { if (video !== vid) reset(video); });
    button.addEventListener('click', () => {
      if (want === name && !failed && (switching || cur === name)) return;
      box.querySelectorAll('.demo-thumb').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      box.scrollTo({left: button.offsetLeft - (box.clientWidth - button.offsetWidth) / 2, behavior: 'smooth'});
      select(name);
    });
    box.appendChild(button);
    if (posterObserver) posterObserver.observe(button);
    else video.poster = video.dataset.poster;
  });
  box.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || box.scrollWidth <= box.clientWidth) return;
    const end = event.deltaY > 0 ? box.scrollLeft + box.clientWidth >= box.scrollWidth - 1 : box.scrollLeft <= 0;
    if (!end) { event.preventDefault(); box.scrollLeft += event.deltaY; }
  }, {passive: false});

  if ('IntersectionObserver' in window) {
    const preloadObserver = new IntersectionObserver(entries => {
      near = entries.some(entry => entry.isIntersecting);
      if (near && !document.hidden && !selection) select(want);
    }, {rootMargin: '160px 0px'});
    preloadObserver.observe(stage);
    const visibilityObserver = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      syncActivity();
    });
    visibilityObserver.observe(stage);
  } else {
    near = visible = true;
    if (!document.hidden) select(want);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && near && !selection) select(want);
    syncActivity();
  });
})();
