(() => {
  const $ = (id) => document.getElementById(id);
  const controls = { kc: $('kc'), ti: $('ti'), td: $('td'), target: $('target') };
  const outputs = { kc: $('kcOut'), ti: $('tiOut'), td: $('tdOut'), target: $('targetOut') };
  const chart = $('responseChart');
  const ctx = chart.getContext('2d');
  const mint = '#65e6c4', orange = '#ffb36b', muted = '#9aa8bf', grid = '#273149', text = '#edf2fa';
  let result = null;

  function readSettings() { return { kc: +controls.kc.value, ti: +controls.ti.value, td: +controls.td.value, target: +controls.target.value }; }
  function updateOutputs() { Object.keys(controls).forEach(k => outputs[k].value = k === 'kc' ? (+controls[k].value).toFixed(1) : controls[k].value); }

  // Browser implementation of the first-order process and delayed controller output
  // used by pid_tuning.py. Units are illustrative simulation time units.
  function simulate({kc, ti, td, target}) {
    const n = 1001, tf = 1000, dt = tf / (n - 1), processGain = 0.9, tauP = 175, delay = 15;
    const t = [], sp = [], pv = [], op = [], pTerm = [], iTerm = [], dTerm = [];
    let y = 23, integral = 0, previousPv = 23, iae = 0;
    for (let i = 0; i < n; i++) {
      const time = i * dt;
      t.push(time);
      sp.push(target);
      if (i > 0) {
        const delayedIndex = Math.max(0, i - Math.round(delay / dt));
        const delayedOutput = op[delayedIndex] ?? 0;
        y += dt * (-(y - 23) + processGain * delayedOutput) / tauP;
      }
      pv.push(y);
      const error = target - y;
      iae += Math.abs(error) * dt;
      const p = kc * error;
      const d = -kc * td * ((y - previousPv) / dt);
      const proposedIntegral = integral + (kc / ti) * error * dt;
      let output = p + proposedIntegral + d;
      if (output > 100) { output = 100; }
      else if (output < 0) { output = 0; }
      else { integral = proposedIntegral; }
      pTerm.push(p); iTerm.push(integral); dTerm.push(d); op.push(output);
      previousPv = y;
    }
    const peak = Math.max(...pv);
    const overshoot = Math.max(0, (peak - target) / Math.max(1, target - 23) * 100);
    const band = Math.max(1, Math.abs(target) * .02);
    let settling = null;
    for (let i = 0; i < pv.length; i++) {
      let settled = true;
      for (let j = i; j < pv.length; j++) if (Math.abs(pv[j] - target) > band) { settled = false; break; }
      if (settled) { settling = t[i]; break; }
    }
    return {t, sp, pv, op, iae, overshoot, settling, target};
  }

  function fitCanvas(canvas, context) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(280, rect.width), h = Math.max(180, rect.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {w, h};
  }
  function drawChart() {
    const {w, h} = fitCanvas(chart, ctx);
    ctx.clearRect(0, 0, w, h);
    const pad = {l: 43, r: 12, t: 16, b: 31};
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const maxY = Math.max(80, result ? Math.ceil(Math.max(...result.pv, ...result.sp) / 10) * 10 + 10 : 80);
    const x = i => pad.l + (i / 1000) * pw;
    const y = v => pad.t + ph - (v / maxY) * ph;
    ctx.font = '10px DM Mono, monospace'; ctx.lineWidth = 1; ctx.strokeStyle = grid; ctx.fillStyle = muted;
    for (let val = 0; val <= maxY; val += 20) {
      ctx.beginPath(); ctx.moveTo(pad.l, y(val)); ctx.lineTo(w - pad.r, y(val)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(String(val), pad.l - 9, y(val));
    }
    for (let i = 0; i <= 5; i++) {
      const xx = pad.l + pw * i / 5; ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, pad.t + ph); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(String(i * 200), xx, pad.t + ph + 9);
    }
    ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('OUTPUT', pad.l, 0);
    ctx.textAlign = 'right'; ctx.fillText('TIME', w - pad.r, h - 10);
    if (!result) return;
    const drawLine = (values, color, width, dash = []) => {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      values.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
      ctx.stroke(); ctx.setLineDash([]);
    };
    drawLine(result.sp, '#929db5', 1.5, [5, 5]);
    drawLine(result.pv, mint, 2.4);
    const opScaled = result.op.map(v => v * maxY / 100);
    drawLine(opScaled, orange, 1.2, [3, 4]);
  }
  function renderMetrics() {
    $('iaeMetric').textContent = result.iae.toLocaleString(undefined, {maximumFractionDigits: 1});
    $('overshootMetric').textContent = result.overshoot.toFixed(1) + '%';
    $('settlingMetric').textContent = result.settling == null ? 'Not settled' : Math.round(result.settling) + ' s';
    $('sampleCount').textContent = result.t.length + ' samples';
  }
  function runSimulation() {
    updateOutputs(); result = simulate(readSettings()); drawChart(); renderMetrics();
    $('runStatus').textContent = 'SIMULATION COMPLETE';
  }
  Object.values(controls).forEach(el => el.addEventListener('input', () => { updateOutputs(); $('runStatus').textContent = 'PARAMETERS CHANGED'; }));
  $('runBtn').addEventListener('click', runSimulation);
  $('resetBtn').addEventListener('click', () => { controls.kc.value = 5; controls.ti.value = 60; controls.td.value = 7; controls.target.value = 60; runSimulation(); });
  chart.addEventListener('mousemove', event => {
    if (!result) return;
    const rect = chart.getBoundingClientRect(), xPos = event.clientX - rect.left;
    const index = Math.max(0, Math.min(1000, Math.round((xPos - 43) / Math.max(1, rect.width - 55) * 1000)));
    const tip = $('chartTooltip'); tip.hidden = false;
    tip.style.left = Math.max(0, Math.min(rect.width - 140, xPos + 12)) + 'px'; tip.style.top = '12px';
    tip.innerHTML = `t = ${result.t[index].toFixed(0)}<br>SP = ${result.sp[index].toFixed(1)}<br>PV = ${result.pv[index].toFixed(2)}<br>Output = ${result.op[index].toFixed(1)}%`;
  });
  chart.addEventListener('mouseleave', () => $('chartTooltip').hidden = true);

  // Seven-sensor line-following simulation inspired by myLineFollower.py.
  // The sensors sample the drawn track; controller output changes the robot heading.
  const track = $('trackCanvas'), tctx = track.getContext('2d');
  let animationFrame = 0;
  let robot = {x: 0, y: 0, heading: 0, running: false, step: 0, integral: 0, previousError: 0, error: 0, sensors: Array(7).fill(false)};
  const path = [{x:.08,y:.82},{x:.18,y:.78},{x:.28,y:.66},{x:.38,y:.67},{x:.48,y:.52},{x:.57,y:.44},{x:.67,y:.49},{x:.78,y:.31},{x:.91,y:.22}];
  const sensorKp = $('sensorKp'), sensorKi = $('sensorKi'), sensorKd = $('sensorKd');
  const sensorController = $('sensorController');
  function updateSensorGains() {
    $('sensorKpOut').value = (+sensorKp.value).toFixed(1);
    $('sensorKiOut').value = (+sensorKi.value).toFixed(2);
    $('sensorKdOut').value = (+sensorKd.value).toFixed(1);
    const mode = sensorController.value;
    $('sensorKiGroup').style.opacity = mode === 'PID' ? '1' : '.45';
    $('sensorKdGroup').style.opacity = mode === 'P' ? '.45' : '1';
  }
  function resetSensorRobot() {
    robot.running = false; cancelAnimationFrame(animationFrame);
    const a=path[0], b=path[1];
    robot={x:a.x,y:a.y,heading:Math.atan2((b.y-a.y), (b.x-a.x)),running:false,step:0,integral:0,previousError:0,error:0,sensors:Array(7).fill(false)};
    $('robotState').textContent='READY'; $('animateRobot').innerHTML='Run simulation <span>▶</span>';
    updateSensorReadings(); drawTrack();
  }
  function pointSegmentDistance(px,py,ax,ay,bx,by) {
    const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
    const t=den ? Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/den)) : 0;
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }
  function sensorSample() {
    const {w,h}=fitCanvas(track,tctx), px=robot.x*w, py=robot.y*h;
    const forward={x:Math.cos(robot.heading),y:Math.sin(robot.heading)};
    const normal={x:-forward.y,y:forward.x};
    const weights=[-3,-2,-1,0,1,2,3], detected=[];
    const sx=px+forward.x*13, sy=py+forward.y*13;
    for(const weight of weights){
      const x=sx+normal.x*weight*5.2, y=sy+normal.y*weight*5.2;
      let nearest=Infinity;
      for(let i=1;i<path.length;i++) nearest=Math.min(nearest,pointSegmentDistance(x,y,path[i-1].x*w,path[i-1].y*h,path[i].x*w,path[i].y*h));
      detected.push(nearest<=5.5);
    }
    robot.sensors=detected;
    const active=weights.reduce((sum,weight,i)=>sum+(detected[i]?1:0),0);
    if(!active){
      // Keep the last error briefly when all sensors lose the line, so the robot searches toward it.
      robot.error = robot.previousError === 0 ? 0 : Math.sign(robot.previousError)*3;
    } else {
      robot.error=weights.reduce((sum,weight,i)=>sum+(detected[i]?weight:0),0)/active;
    }
    return {w,h,forward,normal,sx,sy,weights};
  }
  function updateSensorReadings(){
    $('sensorBars').querySelectorAll('i').forEach((bar,i)=>bar.classList.toggle('active',!!robot.sensors[i]));
    $('errorReadout').textContent='ERROR: '+robot.error.toFixed(2);
  }
  function drawTrack() {
    const {w,h}=fitCanvas(track,tctx); tctx.clearRect(0,0,w,h); tctx.fillStyle='#111a2b';tctx.fillRect(0,0,w,h);
    tctx.strokeStyle='#202b41';tctx.lineWidth=1;
    for(let xx=0;xx<w;xx+=24){tctx.beginPath();tctx.moveTo(xx,0);tctx.lineTo(xx,h);tctx.stroke();}
    for(let yy=0;yy<h;yy+=24){tctx.beginPath();tctx.moveTo(0,yy);tctx.lineTo(w,yy);tctx.stroke();}
    const pts=path.map(p=>({x:p.x*w,y:p.y*h}));
    tctx.lineCap='round';tctx.lineJoin='round';tctx.strokeStyle='#26324a';tctx.lineWidth=20;tctx.beginPath();pts.forEach((p,i)=>i?tctx.lineTo(p.x,p.y):tctx.moveTo(p.x,p.y));tctx.stroke();
    tctx.strokeStyle='#080d17';tctx.lineWidth=8;tctx.beginPath();pts.forEach((p,i)=>i?tctx.lineTo(p.x,p.y):tctx.moveTo(p.x,p.y));tctx.stroke();
    const {w:sw,h:sh,forward,normal,sx,sy,weights}=sensorSample();
    const cx=robot.x*sw,cy=robot.y*sh;
    tctx.save();tctx.translate(cx,cy);tctx.rotate(robot.heading);
    tctx.fillStyle='#65e6c4';tctx.strokeStyle='#b5ffec';tctx.lineWidth=1.5;tctx.beginPath();tctx.roundRect(-17,-11,34,22,5);tctx.fill();tctx.stroke();
    tctx.fillStyle='#10251f';tctx.beginPath();tctx.moveTo(10,0);tctx.lineTo(2,-5);tctx.lineTo(2,5);tctx.closePath();tctx.fill();tctx.restore();
    // Draw the seven sensing points in world coordinates.
    const sensorX=cx+forward.x*13, sensorY=cy+forward.y*13;
    weights.forEach((weight,i)=>{const x=sensorX+normal.x*weight*5.2,y=sensorY+normal.y*weight*5.2;tctx.beginPath();tctx.arc(x,y,3.1,0,Math.PI*2);tctx.fillStyle=robot.sensors[i]?'#65e6c4':'#53617a';tctx.fill();tctx.strokeStyle='#0b1020';tctx.lineWidth=.7;tctx.stroke();});
    updateSensorReadings();
  }
  function simulationTick(){
    if(!robot.running)return;
    const sample=sensorSample(), mode=sensorController.value;
    const error=robot.error;
    robot.integral=Math.max(-20,Math.min(20,robot.integral+error));
    const derivative=error-robot.previousError;
    const p=Number(sensorKp.value)*error;
    const i=mode==='PID'?Number(sensorKi.value)*robot.integral:0;
    const d=mode==='P'?0:Number(sensorKd.value)*derivative;
    const output=p+i+d;
    // Positive sensor error means the line is to the robot's right in screen coordinates.
    robot.heading += Math.max(-0.18,Math.min(0.18,output*0.012));
    const speed=1.45;
    robot.x += Math.cos(robot.heading)*speed/sample.w;
    robot.y += Math.sin(robot.heading)*speed/sample.h;
    robot.previousError=error; robot.step++;
    if(robot.x<-.02||robot.x>1.02||robot.y<-.02||robot.y>1.02||robot.step>2200){
      robot.running=false;$('robotState').textContent='STOPPED';$('animateRobot').innerHTML='Run again <span>▶</span>';drawTrack();return;
    }
    drawTrack(); animationFrame=requestAnimationFrame(simulationTick);
  }
  $('animateRobot').addEventListener('click',()=>{
    if(robot.running)return;
    if(robot.step>0 && $('robotState').textContent==='STOPPED') resetSensorRobot();
    robot.running=true;$('robotState').textContent='RUNNING';$('animateRobot').innerHTML='Running… <span>Ⅱ</span>';
    animationFrame=requestAnimationFrame(simulationTick);
  });
  $('resetRobot').addEventListener('click',resetSensorRobot);
  [sensorKp,sensorKi,sensorKd].forEach(el=>el.addEventListener('input',()=>{updateSensorGains();}));
  sensorController.addEventListener('change',updateSensorGains);
  if ('ResizeObserver' in window) { new ResizeObserver(() => { drawChart(); drawTrack(); }).observe(chart.parentElement); } else window.addEventListener('resize',()=>{drawChart();drawTrack();});
  updateOutputs(); runSimulation(); updateSensorGains(); resetSensorRobot();
})();
