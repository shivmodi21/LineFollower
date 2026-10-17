(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { kp: 5, ki: 0, kd: 0, speed: 2, lookahead: 24 };
  const controls = {
    kp: $('kp'), ki: $('ki'), kd: $('kd'),
    speed: $('speed'), lookahead: $('lookahead')
  };
  const outputs = {
    kp: $('kpOut'), ki: $('kiOut'), kd: $('kdOut'),
    speed: $('speedOut'), lookahead: $('lookaheadOut')
  };
  const canvas = $('trackCanvas');
  const ctx = canvas.getContext('2d');
  const heroCanvas = $('heroCanvas');
  const heroCtx = heroCanvas.getContext('2d');
  const pidChart = $('pidChart');
  const pidChartCtx = pidChart.getContext('2d');
  let activeMode = 'pid';
  let lastProcessData = null;

  // Same-origin is used on Render. For local development, frontend can be
  // served on another port and the FastAPI API is available at localhost:8000.
  const API_BASE = window.LINEFOLLOWER_API_BASE || (
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    window.location.port && window.location.port !== '8000'
      ? 'http://127.0.0.1:8000'
      : ''
  );

  const state = {
    path: [],
    drawing: false,
    frames: [],
    frameIndex: 0,
    animationId: null,
    playing: false,
    hasRun: false,
    robotTrail: [],
    metrics: null
  };

  const mint = '#65e6c4';
  const orange = '#ffb36b';
  const muted = '#9aa8bf';
  const grid = '#192235';

  function settings() {
    return {
      pid: { kp: Number(controls.kp.value), ki: Number(controls.ki.value), kd: Number(controls.kd.value) },
      speed: Number(controls.speed.value),
      lookahead: Number(controls.lookahead.value),
      max_steps: 1800
    };
  }

  function updateOutputs() {
    Object.keys(controls).forEach((key) => {
      const value = Number(controls[key].value);
      outputs[key].value = ['kp', 'speed'].includes(key) ? value.toFixed(1)
        : key === 'lookahead' ? value.toFixed(0) : value.toFixed(2);
    });
  }

  function setStatus(message, kind = '') {
    const status = $('runStatus');
    status.querySelector('span').textContent = message;
    status.classList.toggle('status-error', kind === 'error');
  }

  function setApiStatus(message, healthy = null) {
    const el = $('apiStatus');
    el.textContent = message;
    el.classList.toggle('api-error', healthy === false);
    el.classList.toggle('api-ok', healthy === true);
  }

  function fitCanvas(target, context) {
    const rect = target.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (target.width !== Math.round(w * dpr) || target.height !== Math.round(h * dpr)) {
      target.width = Math.round(w * dpr);
      target.height = Math.round(h * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function drawGrid(context, w, h, spacing = 24, color = grid) {
    context.strokeStyle = color;
    context.lineWidth = 1;
    for (let x = 0; x <= w; x += spacing) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
    }
    for (let y = 0; y <= h; y += spacing) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
    }
  }

  function drawPolyline(context, points, color, width, dash = []) {
    if (!points || points.length < 2) return;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.setLineDash(dash);
    context.beginPath();
    points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
    context.stroke();
    context.restore();
  }

  function drawRobot(context, frame, scale = 1) {
    if (!frame) return;
    context.save();
    context.translate(frame.x, frame.y);
    context.rotate(frame.heading);
    context.scale(scale, scale);
    context.fillStyle = mint;
    context.strokeStyle = '#c1fff0';
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(-12, -8, 24, 16, 4);
    context.fill();
    context.stroke();
    context.fillStyle = '#0b1020';
    context.beginPath();
    context.moveTo(7, 0); context.lineTo(0, -4); context.lineTo(0, 4); context.closePath();
    context.fill();
    context.fillStyle = orange;
    context.beginPath(); context.arc(0, 0, 2, 0, Math.PI * 2); context.fill();
    // Only sensor-based frames carry a sensors array; the established path-aware robot drawing stays unchanged.
    if (Array.isArray(frame.sensors)) {
      const count = frame.sensors.length;
      const spacing = count > 1 ? 18 / (count - 1) : 0;
      frame.sensors.forEach((active, index) => {
        const sx = 10 + index * spacing;
        const sy = count > 1 ? -8 + index * (16 / (count - 1)) : 0;
        context.beginPath(); context.arc(sx, sy, 2.1, 0, Math.PI * 2);
        context.fillStyle = active ? '#ffb36b' : '#536078'; context.fill();
      });
    }
    context.restore();
  }

  function drawCanvas() {
    const { w, h } = fitCanvas(canvas, ctx);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#03060c';
    ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, w, h, 28, '#101827');

    // A faint start marker helps users see where the robot will begin.
    if (state.path.length) {
      ctx.fillStyle = '#1e3d38';
      ctx.beginPath(); ctx.arc(state.path[0].x, state.path[0].y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = mint; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(state.path[0].x, state.path[0].y, 4, 0, Math.PI * 2); ctx.stroke();
    }

    drawPolyline(ctx, state.path, mint, 4);
    drawPolyline(ctx, state.robotTrail, orange, 2);

    if (state.frames.length && state.frameIndex < state.frames.length) {
      drawRobot(ctx, state.frames[state.frameIndex]);
    }

    $('canvasEmpty').classList.toggle('hidden', state.path.length > 0);
    $('pointCount').textContent = `${state.path.length} point${state.path.length === 1 ? '' : 's'}`;
  }

  function drawHero() {
    const { w, h } = fitCanvas(heroCanvas, heroCtx);
    heroCtx.clearRect(0, 0, w, h);
    heroCtx.fillStyle = '#0b1220';
    heroCtx.fillRect(0, 0, w, h);
    drawGrid(heroCtx, w, h, 30, '#18243a');
    const pts = [
      {x: w*.06, y:h*.78}, {x:w*.18,y:h*.72}, {x:w*.27,y:h*.55},
      {x:w*.43,y:h*.59}, {x:w*.55,y:h*.38}, {x:w*.68,y:h*.32},
      {x:w*.77,y:h*.43}, {x:w*.91,y:h*.18}
    ];
    drawPolyline(heroCtx, pts, '#1b3b35', 13);
    drawPolyline(heroCtx, pts, mint, 2);
    const p = pts[4];
    drawRobot(heroCtx, {x:p.x,y:p.y,heading:Math.atan2(pts[5].y-pts[4].y,pts[5].x-pts[4].x)}, .9);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    };
  }

  function clearRunState() {
    stopAnimation();
    state.frames = [];
    state.frameIndex = 0;
    state.robotTrail = [];
    state.metrics = null;
    state.hasRun = false;
    $('meanError').textContent = '—';
    $('maxError').textContent = '—';
    $('resultMetric').textContent = '—';
    $('resultHint').textContent = 'Waiting for a run';
    $('currentError').textContent = '—';
    $('currentSteering').textContent = '—';
    $('currentStep').textContent = '—';
    $('pauseBtn').disabled = true;
    $('pauseBtn').textContent = 'Pause';
    drawCanvas();
  }

  function pointerDown(event) {
    if (state.playing) stopAnimation();
    clearRunState();
    state.drawing = true;
    state.path = [];
    canvas.setPointerCapture?.(event.pointerId);
    state.path.push(canvasPoint(event));
    drawCanvas();
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!state.drawing) return;
    const p = canvasPoint(event);
    const last = state.path[state.path.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 3) {
      if (state.path.length < 2000) state.path.push(p);
      drawCanvas();
    }
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!state.drawing) return;
    state.drawing = false;
    if (state.path.length > 1) {
      setStatus('TRACK READY');
      $('canvasEmpty').classList.add('hidden');
    } else {
      setStatus('DRAW A LONGER TRACK');
    }
    drawCanvas();
    try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
  }

  function drawPidChart(data = lastProcessData) {
    const rect = pidChart.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pidChart.width = Math.round(rect.width * dpr);
    pidChart.height = Math.round(rect.height * dpr);
    const c = pidChartCtx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    c.clearRect(0, 0, w, h); c.fillStyle = '#03060c'; c.fillRect(0, 0, w, h);
    const pad = {l:48, r:18, t:24, b:36};
    const pw = w-pad.l-pad.r, ph = h-pad.t-pad.b;
    c.strokeStyle = '#182235'; c.lineWidth = 1; c.fillStyle = '#8290a8';
    c.font = '10px monospace';
    for (let i=0;i<=5;i++) { const y=pad.t+ph*i/5; c.beginPath(); c.moveTo(pad.l,y); c.lineTo(w-pad.r,y); c.stroke(); c.fillText(String(100-i*20),8,y+3); }
    for (let i=0;i<=5;i++) { const x=pad.l+pw*i/5; c.beginPath(); c.moveTo(x,pad.t); c.lineTo(x,h-pad.b); c.stroke(); c.fillText(String(Math.round(i*200)),x-10,h-13); }
    c.fillStyle = '#9aa8bf'; c.fillText('Process value',pad.l,13); c.fillText('Time',w/2-12,h-3);
    if (!data || !Array.isArray(data.pv) || !data.pv.length) {
      c.fillStyle='#9aa8bf'; c.font='13px sans-serif'; c.fillText('Adjust the controller, then wait for the response plot.',pad.l+10,h/2); return;
    }
    const maxT = data.t[data.t.length-1] || 1000;
    const target = Number(data.target ?? $('targetSetpoint').value);
    const minY = 0, maxY = 100;
    const px = (i) => pad.l + (data.t[i]/maxT)*pw;
    const py = (v) => pad.t + (maxY-v)/(maxY-minY)*ph;
    function line(values,color,width=2,dash=[]) { c.save(); c.strokeStyle=color; c.lineWidth=width; c.setLineDash(dash); c.beginPath(); values.forEach((v,i)=>i?c.lineTo(px(i),py(v)):c.moveTo(px(i),py(v))); c.stroke(); c.restore(); }
    line(data.sp,'#ffb36b',1.8,[6,4]); line(data.pv,'#65e6c4',2.2);
    c.fillStyle='#65e6c4'; c.fillRect(pad.l, h-24, 12, 3); c.fillStyle='#9aa8bf'; c.fillText('PV · process value',pad.l+17,h-20);
    c.fillStyle='#ffb36b'; c.fillRect(pad.l+142,h-24,12,3); c.fillStyle='#9aa8bf'; c.fillText(`SP · target ${target}`,pad.l+159,h-20);
  }

  async function updatePidPlot() {
    if (activeMode !== 'pid') return;
    const target = Number($('targetSetpoint').value);
    $('targetSetpointOut').value = String(target);
    drawPidChart(null);
    try {
      const kp = Number(controls.kp.value);
      const ki = Number(controls.ki.value);
      const kd = Number(controls.kd.value);
      const response = await fetch(`${API_BASE}/api/pid-process`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({kc: Math.max(0.1, Math.min(15, kp)), ti: Math.max(5, Math.min(180, 60/(1+ki))), td: Math.max(0, Math.min(30, kd)), target, samples: 1001})
      });
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(responseMessage(data,response));
      lastProcessData = data; drawPidChart(data);
      setApiStatus('PID response calculated by backend', true);
    } catch (error) {
      lastProcessData = null; drawPidChart(null);
      setApiStatus(`PID plot unavailable: ${error.message || 'backend error'}`, false);
    }
  }

  function setMode(mode) {
    activeMode = mode;
    const panel = $('viewPanel');
    panel.classList.toggle('pid-mode', mode === 'pid');
    document.querySelectorAll('.mode-tab').forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('targetSetpointGroup').hidden = mode !== 'pid';
    $('sensorCountGroup').hidden = mode !== 'sensor';
    $('pidChart').hidden = mode !== 'pid';
    $('trackCanvas').hidden = mode === 'pid';
    $('canvasEmpty').hidden = mode === 'pid';
    if (mode === 'pid') {
      $('drawingHeading').querySelector('.panel-kicker').textContent = 'CONTROLLER RESPONSE';
      $('drawingHeading').querySelector('h3').textContent = 'PID process response';
      $('runStatus').querySelector('span').textContent = 'TUNING';
      requestAnimationFrame(() => { drawPidChart(); updatePidPlot(); });
    } else {
      $('drawingHeading').querySelector('.panel-kicker').textContent = mode === 'sensor' ? 'SENSOR SIMULATION' : 'PATH SIMULATION';
      $('drawingHeading').querySelector('h3').textContent = mode === 'sensor' ? 'Sensor-based line following' : 'Path-aware line following';
      $('runStatus').querySelector('span').textContent = state.path.length > 1 ? 'TRACK READY' : 'READY';
      drawCanvas();
    }
  }

  async function checkBackend() {
    try {
      const response = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setApiStatus('Backend connected', true);
    } catch (error) {
      setApiStatus('Backend unavailable — start FastAPI on port 8000', false);
    }
  }

  function responseMessage(data, response) {
    if (data && typeof data.detail === 'string') return data.detail;
    if (data && Array.isArray(data.detail)) return data.detail.map(e => e.msg).join('; ');
    return `Simulation request failed (${response.status}).`;
  }

  async function runSimulation() {
    if (state.drawing) {
      setStatus('FINISH DRAWING FIRST', 'error');
      return;
    }
    if (state.path.length < 2) {
      setStatus('DRAW A TRACK FIRST', 'error');
      return;
    }

    stopAnimation();
    $('startBtn').disabled = true;
    $('restartBtn').disabled = true;
    setStatus('SIMULATING…');
    setApiStatus('Sending track to backend…');

    try {
      const rect = canvas.getBoundingClientRect();
      const isSensorMode = activeMode === 'sensor';
      const normalizedPath = state.path.map(point => ({ x: point.x / Math.max(1, rect.width), y: point.y / Math.max(1, rect.height) }));
      const payload = isSensorMode
        ? { path: normalizedPath, sensor_model: ({'2':'two','5':'five','7':'seven'})[$('sensorCount').value], controller: 'PID', pid: settings().pid, canvas_width: Math.round(rect.width), canvas_height: Math.round(rect.height), speed: Math.min(5, settings().speed), max_steps: 2200 }
        : { path: state.path, ...settings() };
      const endpoint = isSensorMode ? '/api/sensor-simulate' : '/api/simulate';
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(data, response));
      if (!Array.isArray(data.frames) || data.frames.length === 0) {
        throw new Error('The backend returned no simulation frames.');
      }

      state.frames = isSensorMode ? data.frames.map(frame => ({
        ...frame,
        x: frame.x * rect.width,
        y: frame.y * rect.height,
        cross_track_error: frame.error
      })) : data.frames;
      state.frameIndex = 0;
      state.robotTrail = [];
      state.metrics = data.metrics || {};
      state.hasRun = true;
      renderMetrics(state.metrics);
      setApiStatus('Simulation calculated by backend', true);
      setStatus('RUNNING');
      $('pauseBtn').disabled = false;
      $('pauseBtn').textContent = 'Pause';
      state.playing = true;
      $('startBtn').disabled = false;
      $('restartBtn').disabled = false;
      animateNextFrame();
    } catch (error) {
      setStatus('SIMULATION FAILED', 'error');
      setApiStatus(error.message || 'Could not reach the backend', false);
      $('startBtn').disabled = false;
      $('restartBtn').disabled = false;
    }
  }

  function renderMetrics(metrics) {
    $('meanError').textContent = `${Number(metrics.mean_absolute_error_px ?? 0).toFixed(2)} px`;
    $('maxError').textContent = `${Number(metrics.max_error_px ?? 0).toFixed(2)} px`;
    $('resultMetric').textContent = metrics.reached_endpoint ? 'Completed' : 'Stopped';
    $('resultHint').textContent = metrics.reached_endpoint
      ? 'Reached the end of the track'
      : 'Step limit reached before endpoint';
    $('currentStep').textContent = `0 / ${metrics.steps ?? '—'}`;
  }

  function animateNextFrame() {
    if (!state.playing || !state.frames.length) return;
    const frame = state.frames[state.frameIndex];
    if (!frame) {
      finishAnimation();
      return;
    }
    state.robotTrail.push({ x: frame.x, y: frame.y });
    if (state.robotTrail.length > 700) state.robotTrail.shift();
    $('currentError').textContent = `${Number(frame.cross_track_error).toFixed(2)} px`;
    $('currentSteering').textContent = Number(frame.steering).toFixed(4);
    $('currentStep').textContent = `${frame.step} / ${state.metrics?.steps ?? state.frames.length}`;
    drawCanvas();
    state.frameIndex += 1;

    if (state.frameIndex >= state.frames.length) {
      finishAnimation();
      return;
    }
    // Backend returns sampled frames; this delay keeps the animation readable.
    state.animationId = window.setTimeout(animateNextFrame, 16);
  }

  function finishAnimation() {
    state.playing = false;
    state.animationId = null;
    $('pauseBtn').disabled = true;
    $('pauseBtn').textContent = 'Pause';
    setStatus(state.metrics?.reached_endpoint ? 'TRACK COMPLETE' : 'SIMULATION COMPLETE');
    drawCanvas();
  }

  function stopAnimation() {
    state.playing = false;
    if (state.animationId !== null) {
      clearTimeout(state.animationId);
      state.animationId = null;
    }
  }

  function pauseResume() {
    if (state.playing) {
      stopAnimation();
      $('pauseBtn').textContent = 'Resume';
      setStatus('PAUSED');
    } else if (state.frames.length && state.frameIndex < state.frames.length) {
      state.playing = true;
      $('pauseBtn').textContent = 'Pause';
      setStatus('RUNNING');
      animateNextFrame();
    }
  }

  function resetPid() {
    controls.kp.value = DEFAULTS.kp;
    controls.ki.value = DEFAULTS.ki;
    controls.kd.value = DEFAULTS.kd;
    controls.speed.value = DEFAULTS.speed;
    controls.lookahead.value = DEFAULTS.lookahead;
    updateOutputs();
    clearRunState();
    setStatus(state.path.length > 1 ? 'TRACK READY' : 'READY');
    setApiStatus('PID defaults restored');
  }

  function clearTrack() {
    state.path = [];
    clearRunState();
    setStatus('READY');
    setApiStatus('Track cleared');
  }

  function loadExample() {
    const { w, h } = canvas.getBoundingClientRect();
    state.path = [
      {x: w * .06, y: h * .78},
      {x: w * .15, y: h * .76},
      {x: w * .23, y: h * .64},
      {x: w * .32, y: h * .56},
      {x: w * .43, y: h * .60},
      {x: w * .52, y: h * .43},
      {x: w * .61, y: h * .35},
      {x: w * .72, y: h * .42},
      {x: w * .81, y: h * .25},
      {x: w * .94, y: h * .19}
    ];
    clearRunState();
    setStatus('EXAMPLE TRACK READY');
    setApiStatus('Example track loaded');
    drawCanvas();
  }

  document.querySelectorAll('.mode-tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
  $('targetSetpoint').addEventListener('input', () => { $('targetSetpointOut').value = $('targetSetpoint').value; updatePidPlot(); });
  $('sensorCount').addEventListener('change', () => setApiStatus(`${$('sensorCount').value}-sensor mode selected`));

  Object.values(controls).forEach((input) => {
    input.addEventListener('input', () => {
      updateOutputs();
      if (state.hasRun) setStatus('PARAMETERS CHANGED — RESTART TO APPLY');
      if (activeMode === 'pid') updatePidPlot();
    });
  });

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  $('startBtn').addEventListener('click', () => activeMode === 'pid' ? updatePidPlot() : runSimulation());
  $('restartBtn').addEventListener('click', () => activeMode === 'pid' ? updatePidPlot() : runSimulation());
  $('pauseBtn').addEventListener('click', pauseResume);
  $('resetPidBtn').addEventListener('click', resetPid);
  $('clearBtn').addEventListener('click', clearTrack);
  $('exampleBtn').addEventListener('click', loadExample);

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => { drawCanvas(); drawHero(); if (activeMode === 'pid') drawPidChart(); });
    observer.observe(canvas.parentElement);
    observer.observe(heroCanvas.parentElement);
  } else {
    window.addEventListener('resize', () => { drawCanvas(); drawHero(); if (activeMode === 'pid') drawPidChart(); });
  }

  updateOutputs();
  drawCanvas();
  drawHero();
  setMode('pid');
  checkBackend();
})();