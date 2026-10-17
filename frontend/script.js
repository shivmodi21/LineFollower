(() => {
    const $ = (id) => document.getElementById(id);
    const controls = {
        kc: $('kc'),
        ti: $('ti'),
        td: $('td'),
        target: $('target')
    };
    const outputs = {
        kc: $('kcOut'),
        ti: $('tiOut'),
        td: $('tdOut'),
        target: $('targetOut')
    };
    const chart = $('responseChart');
    const ctx = chart.getContext('2d');
    const mint = '#65e6c4',
        orange = '#ffb36b',
        muted = '#9aa8bf',
        grid = '#273149',
        text = '#edf2fa';
    let result = null;

    function readSettings() {
        return {
            kc: +controls.kc.value,
            ti: +controls.ti.value,
            td: +controls.td.value,
            target: +controls.target.value
        };
    }

    function updateOutputs() {
        Object.keys(controls).forEach(k => outputs[k].value = k === 'kc' ? (+controls[k].value).toFixed(1) : controls[k].value);
    }

    // The process model and PID calculations now run in FastAPI.
    async function requestJSON(url, options, fallbackMessage) {
        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            throw new Error(`Cannot reach the API. Check that the backend is running and the URL is correct. (${error.message})`);
        }
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error(`The API returned an unreadable response (HTTP ${response.status}).`);
        }
        if (!response.ok) {
            const detail = data.detail;
            const message = Array.isArray(detail) ?
                detail.map(item => item.msg || JSON.stringify(item)).join('; ') :
                (typeof detail === 'string' ? detail : fallbackMessage);
            throw new Error(message || `${fallbackMessage} (HTTP ${response.status})`);
        }
        return data;
    }

    async function simulate(settings) {
        return requestJSON(`${API_BASE}/api/pid-process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        }, 'PID process simulation request failed.');
    }

    function fitCanvas(canvas, context) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(280, rect.width),
            h = Math.max(180, rect.height);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        return {
            w,
            h
        };
    }

    function drawChart() {
        const {
            w,
            h
        } = fitCanvas(chart, ctx);
        ctx.clearRect(0, 0, w, h);
        const pad = {
            l: 43,
            r: 12,
            t: 16,
            b: 31
        };
        const pw = w - pad.l - pad.r,
            ph = h - pad.t - pad.b;
        const maxY = Math.max(80, result ? Math.ceil(Math.max(...result.pv, ...result.sp) / 10) * 10 + 10 : 80);
        const sampleCount = result?.t?.length || 1;
        const x = i => pad.l + (i / Math.max(1, sampleCount - 1)) * pw;
        const y = v => pad.t + ph - (v / maxY) * ph;
        ctx.font = '10px DM Mono, monospace';
        ctx.lineWidth = 1;
        ctx.strokeStyle = grid;
        ctx.fillStyle = muted;
        for (let val = 0; val <= maxY; val += 20) {
            ctx.beginPath();
            ctx.moveTo(pad.l, y(val));
            ctx.lineTo(w - pad.r, y(val));
            ctx.stroke();
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(val), pad.l - 9, y(val));
        }
        for (let i = 0; i <= 5; i++) {
            const xx = pad.l + pw * i / 5;
            ctx.beginPath();
            ctx.moveTo(xx, pad.t);
            ctx.lineTo(xx, pad.t + ph);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(String(i * 200), xx, pad.t + ph + 9);
        }
        ctx.fillStyle = muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('OUTPUT', pad.l, 0);
        ctx.textAlign = 'right';
        ctx.fillText('TIME', w - pad.r, h - 10);
        if (!result) return;
        const drawLine = (values, color, width, dash = []) => {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            values.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
            ctx.stroke();
            ctx.setLineDash([]);
        };
        drawLine(result.sp, '#929db5', 1.5, [5, 5]);
        drawLine(result.pv, mint, 2.4);
        const opScaled = result.op.map(v => v * maxY / 100);
        drawLine(opScaled, orange, 1.2, [3, 4]);
    }

    function renderMetrics() {
        $('iaeMetric').textContent = result.iae.toLocaleString(undefined, {
            maximumFractionDigits: 1
        });
        $('overshootMetric').textContent = result.overshoot.toFixed(1) + '%';
        $('settlingMetric').textContent = result.settling == null ? 'Not settled' : Math.round(result.settling) + ' s';
        $('sampleCount').textContent = result.t.length + ' samples';
    }
    async function runSimulation() {
        updateOutputs();
        $('runBtn').disabled = true;
        $('runStatus').textContent = 'CALCULATING…';
        try {
            result = await simulate(readSettings());
            drawChart();
            renderMetrics();
            $('runStatus').textContent = 'SIMULATION COMPLETE';
        } catch (error) {
            $('runStatus').textContent = 'API ERROR';
            $('iaeMetric').textContent = '—';
            $('overshootMetric').textContent = '—';
            $('settlingMetric').textContent = '—';
            $('sampleCount').textContent = error.message || 'Could not reach API';
        } finally {
            $('runBtn').disabled = false;
        }
    }
    Object.values(controls).forEach(el => el.addEventListener('input', () => {
        updateOutputs();
        $('runStatus').textContent = 'PARAMETERS CHANGED';
    }));
    $('runBtn').addEventListener('click', runSimulation);
    $('resetBtn').addEventListener('click', () => {
        controls.kc.value = 5;
        controls.ti.value = 60;
        controls.td.value = 7;
        controls.target.value = 60;
        runSimulation();
    });
    chart.addEventListener('mousemove', event => {
        if (!result) return;
        const rect = chart.getBoundingClientRect(),
            xPos = event.clientX - rect.left;
        const index = Math.max(0, Math.min(1000, Math.round((xPos - 43) / Math.max(1, rect.width - 55) * 1000)));
        const tip = $('chartTooltip');
        tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(rect.width - 140, xPos + 12)) + 'px';
        tip.style.top = '12px';
        tip.textContent = `t = ${result.t[index].toFixed(0)} · SP = ${result.sp[index].toFixed(1)} · PV = ${result.pv[index].toFixed(2)} · Output = ${result.op[index].toFixed(1)}%`;
    });
    chart.addEventListener('mouseleave', () => $('chartTooltip').hidden = true);

    // Sensor simulation calculations now run in FastAPI. The browser only renders
    // the returned frames so all sensor models share the same backend implementation.
    const track = $('trackCanvas'),
        tctx = track.getContext('2d');
    let animationFrame = 0,
        sensorFrames = [],
        sensorFrameIndex = 0,
        requestToken = 0;
    let robot = {
        x: 0,
        y: 0,
        heading: 0,
        running: false,
        step: 0,
        integral: 0,
        previousError: 0,
        error: 0,
        sensors: Array(7).fill(false)
    };
    const examplePath = [{
        x: .08,
        y: .82
    }, {
        x: .18,
        y: .78
    }, {
        x: .28,
        y: .66
    }, {
        x: .38,
        y: .67
    }, {
        x: .48,
        y: .52
    }, {
        x: .57,
        y: .44
    }, {
        x: .67,
        y: .49
    }, {
        x: .78,
        y: .31
    }, {
        x: .91,
        y: .22
    }];
    let path = examplePath.map(point => ({
        ...point
    }));
    let drawingEnabled = false,
        isDrawing = false;
    const sensorKp = $('sensorKp'),
        sensorKi = $('sensorKi'),
        sensorKd = $('sensorKd');
    const sensorController = $('sensorController');
    const sensorModel = $('sensorModel');
    const sensorWeights = {
        '7': [-3, -2, -1, 0, 1, 2, 3],
        '2': [-1, 1],
        '1': [-1.8]
    };
    const sensorModelApi = {
        '7': 'seven',
        '2': 'two',
        '1': 'single'
    };
    const API_BASE = (location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname)) ?
        'http://127.0.0.1:8000' : location.origin;

    function updateSensorGains() {
        $('sensorKpOut').value = (+sensorKp.value).toFixed(1);
        $('sensorKiOut').value = (+sensorKi.value).toFixed(2);
        $('sensorKdOut').value = (+sensorKd.value).toFixed(1);
        const mode = sensorController.value;
        const kiEnabled = mode === 'PID';
        const kdEnabled = mode !== 'P';
        sensorKi.disabled = !kiEnabled;
        sensorKd.disabled = !kdEnabled;
        $('sensorKiGroup').style.opacity = kiEnabled ? '1' : '.45';
        $('sensorKdGroup').style.opacity = kdEnabled ? '1' : '.45';
    }

    function updateSensorReadings() {
        const bars = $('sensorBars').querySelectorAll('i');
        bars.forEach((bar, i) => {
            bar.hidden = i >= robot.sensors.length;
            bar.classList.toggle('active', !!robot.sensors[i]);
        });
        $('sensorReadoutLabel').textContent = 'SENSOR ARRAY · ' + robot.sensors.length;
        $('errorReadout').textContent = 'ERROR: ' + Number(robot.error || 0).toFixed(2);
        const notes = {
            '7': 'Seven sensors estimate line position using a weighted average. Sensor and controller calculations run on the backend.',
            '2': 'Two sensors use rule-based steering. Sensor states and steering are calculated by the backend.',
            '1': 'A single offset sensor demonstrates edge tracking. Sensor states and steering are calculated by the backend.'
        };
        $('sensorModelNote').textContent = notes[sensorModel.value];
    }

    function drawTrack() {
        const {
            w,
            h
        } = fitCanvas(track, tctx);
        tctx.clearRect(0, 0, w, h);
        tctx.fillStyle = '#111a2b';
        tctx.fillRect(0, 0, w, h);
        tctx.strokeStyle = '#202b41';
        tctx.lineWidth = 1;
        for (let xx = 0; xx < w; xx += 24) {
            tctx.beginPath();
            tctx.moveTo(xx, 0);
            tctx.lineTo(xx, h);
            tctx.stroke();
        }
        for (let yy = 0; yy < h; yy += 24) {
            tctx.beginPath();
            tctx.moveTo(0, yy);
            tctx.lineTo(w, yy);
            tctx.stroke();
        }
        const pts = path.map(p => ({
            x: p.x * w,
            y: p.y * h
        }));
        if (pts.length > 1) {
            tctx.lineCap = 'round';
            tctx.lineJoin = 'round';
            tctx.strokeStyle = '#26324a';
            tctx.lineWidth = 20;
            tctx.beginPath();
            pts.forEach((p, i) => i ? tctx.lineTo(p.x, p.y) : tctx.moveTo(p.x, p.y));
            tctx.stroke();
            tctx.strokeStyle = '#080d17';
            tctx.lineWidth = 8;
            tctx.beginPath();
            pts.forEach((p, i) => i ? tctx.lineTo(p.x, p.y) : tctx.moveTo(p.x, p.y));
            tctx.stroke();
        } else if (pts.length === 1) {
            tctx.beginPath();
            tctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
            tctx.fillStyle = '#080d17';
            tctx.fill();
        }
        if (drawingEnabled) {
            updateSensorReadings();
            return;
        }
        const weights = sensorWeights[sensorModel.value] || sensorWeights['7'];
        const forward = {
            x: Math.cos(robot.heading),
            y: Math.sin(robot.heading)
        };
        const normal = {
            x: -forward.y,
            y: forward.x
        };
        const cx = robot.x * w,
            cy = robot.y * h;
        tctx.save();
        tctx.translate(cx, cy);
        tctx.rotate(robot.heading);
        tctx.fillStyle = '#65e6c4';
        tctx.strokeStyle = '#b5ffec';
        tctx.lineWidth = 1.5;
        tctx.beginPath();
        tctx.roundRect(-17, -11, 34, 22, 5);
        tctx.fill();
        tctx.stroke();
        tctx.fillStyle = '#10251f';
        tctx.beginPath();
        tctx.moveTo(10, 0);
        tctx.lineTo(2, -5);
        tctx.lineTo(2, 5);
        tctx.closePath();
        tctx.fill();
        tctx.restore();
        const sensorX = cx + forward.x * 13,
            sensorY = cy + forward.y * 13;
        weights.forEach((weight, i) => {
            const x = sensorX + normal.x * weight * 5.2,
                y = sensorY + normal.y * weight * 5.2;
            tctx.beginPath();
            tctx.arc(x, y, 3.1, 0, Math.PI * 2);
            tctx.fillStyle = robot.sensors[i] ? '#65e6c4' : '#53617a';
            tctx.fill();
            tctx.strokeStyle = '#0b1020';
            tctx.lineWidth = .7;
            tctx.stroke();
        });
        updateSensorReadings();
    }

    function resetSensorRobot() {
        requestToken++;
        robot.running = false;
        cancelAnimationFrame(animationFrame);
        sensorFrames = [];
        sensorFrameIndex = 0;
        if (path.length >= 2) {
            const a = path[0],
                b = path[1];
            robot = {
                x: a.x,
                y: a.y,
                heading: Math.atan2((b.y - a.y) * track.height, (b.x - a.x) * track.width),
                running: false,
                step: 0,
                integral: 0,
                previousError: 0,
                error: 0,
                sensors: Array(sensorWeights[sensorModel.value].length).fill(false)
            };
            $('robotState').textContent = drawingEnabled ? 'DRAW MODE' : 'READY';
        } else {
            robot = {
                x: 0,
                y: 0,
                heading: 0,
                running: false,
                step: 0,
                integral: 0,
                previousError: 0,
                error: 0,
                sensors: Array(sensorWeights[sensorModel.value].length).fill(false)
            };
            $('robotState').textContent = drawingEnabled ? 'DRAW MODE' : 'NO TRACK';
        }
        $('animateRobot').disabled = drawingEnabled || path.length < 2;
        $('animateRobot').innerHTML = 'Run simulation <i class="fa-solid fa-play" aria-hidden="true"></i>';
        updateSensorReadings();
        drawTrack();
    }

    function animateSensorFrames(token) {
        if (token !== requestToken || !robot.running) return;
        if (sensorFrameIndex >= sensorFrames.length) {
            robot.running = false;
            $('robotState').textContent = 'COMPLETE';
            $('animateRobot').innerHTML = 'Run again <i class="fa-solid fa-play" aria-hidden="true"></i>';
            return;
        }
        const frame = sensorFrames[sensorFrameIndex++];
        robot = {
            ...robot,
            ...frame,
            running: true,
            step: frame.step,
            sensors: frame.sensors || []
        };
        drawTrack();
        animationFrame = requestAnimationFrame(() => animateSensorFrames(token));
    }
    async function runSensorSimulation() {
        if (robot.running || drawingEnabled) return;
        if (path.length < 2 || pathLength(path) < 8) {
            $('robotState').textContent = 'TRACK TOO SHORT';
            $('drawHint').textContent = 'Draw a longer continuous path before running the robot.';
            return;
        }
        const token = ++requestToken;
        robot.running = false;
        cancelAnimationFrame(animationFrame);
        $('robotState').textContent = 'CALCULATING';
        $('animateRobot').disabled = true;
        $('animateRobot').innerHTML = 'Calculating… <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
        const {
            w,
            h
        } = fitCanvas(track, tctx);
        const payload = {
            path,
            sensor_model: sensorModelApi[sensorModel.value],
            controller: sensorController.value,
            pid: {
                kp: Number(sensorKp.value),
                ki: Number(sensorKi.value),
                kd: Number(sensorKd.value)
            },
            canvas_width: Math.max(120, Math.round(w)),
            canvas_height: Math.max(120, Math.round(h)),
            speed: 1.45,
            max_steps: 2200
        };
        try {
            const data = await requestJSON(`${API_BASE}/api/sensor-simulate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }, 'Sensor simulation request failed.');
            if (token !== requestToken) return;
            sensorFrames = data.frames || [];
            if (!sensorFrames.length) throw new Error('The backend returned no simulation frames.');
            sensorFrameIndex = 0;
            $('robotState').textContent = 'RUNNING';
            $('animateRobot').innerHTML = 'Running… <i class="fa-solid fa-pause" aria-hidden="true"></i>';
            robot.running = true;
            animateSensorFrames(token);
        } catch (error) {
            if (token !== requestToken) return;
            $('robotState').textContent = 'API ERROR';
            $('animateRobot').innerHTML = 'Retry simulation <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
            $('sensorModelNote').textContent = `Could not run backend simulation: ${error.message}. Start FastAPI at http://127.0.0.1:8000 or check the deployed API URL.`;
        } finally {
            if (token === requestToken) $('animateRobot').disabled = false;
        }
    }

    function pathLength(points) {
        return points.slice(1).reduce((total, point, index) => total + Math.hypot((point.x - points[index].x) * track.clientWidth, (point.y - points[index].y) * track.clientHeight), 0);
    }

    function setDrawingMode(enabled) {
        drawingEnabled = enabled;
        $('drawTrackBtn').innerHTML = enabled ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Finish drawing' : '<i class="fa-solid fa-pencil" aria-hidden="true"></i> Draw track';
        $('drawTrackBtn').classList.toggle('primary', enabled);
        $('drawTrackBtn').classList.toggle('secondary', !enabled);
        track.classList.toggle('drawing', enabled);
        $('animateRobot').disabled = enabled || path.length < 2;
        $('exampleTrackBtn').disabled = enabled;
        $('clearTrackBtn').disabled = enabled;
        $('drawHint').textContent = enabled ? 'Drag on the canvas with your mouse or finger to draw one continuous black line. Select “Finish drawing” when done.' : 'Choose “Draw track” to edit the path, or run the robot on the current track.';
        $('robotState').textContent = enabled ? 'DRAW MODE' : (path.length >= 2 ? 'READY' : 'NO TRACK');
    }

    function canvasPoint(event) {
        const rect = track.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
        };
    }
    $('drawTrackBtn').addEventListener('click', () => {
        if (drawingEnabled) {
            isDrawing = false;
            setDrawingMode(false);
            if (path.length < 2 || pathLength(path) < 8) {
                $('drawHint').textContent = 'That path is too short. Choose “Draw track” and draw a longer line.';
                $('animateRobot').disabled = true;
                $('robotState').textContent = 'TRACK TOO SHORT';
                return;
            }
            resetSensorRobot();
            $('drawHint').textContent = 'Track saved. Run the simulation to make the robot follow your path.';
        } else {
            requestToken++;
            robot.running = false;
            cancelAnimationFrame(animationFrame);
            path = [];
            isDrawing = false;
            setDrawingMode(true);
            resetSensorRobot();
            drawTrack();
        }
    });
    track.addEventListener('pointerdown', event => {
        if (!drawingEnabled) return;
        event.preventDefault();
        track.setPointerCapture?.(event.pointerId);
        isDrawing = true;
        path = [canvasPoint(event)];
        drawTrack();
    });
    track.addEventListener('pointermove', event => {
        if (!drawingEnabled || !isDrawing) return;
        const point = canvasPoint(event),
            previous = path[path.length - 1];
        const distance = Math.hypot((point.x - previous.x) * track.clientWidth, (point.y - previous.y) * track.clientHeight);
        if (distance >= 2) {
            path.push(point);
            if (path.length > 2000) path = path.filter((_, index) => index % 2 === 0);
            drawTrack();
        }
    });

    function finishPointerDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        drawTrack();
    }
    track.addEventListener('pointerup', finishPointerDrawing);
    track.addEventListener('pointercancel', finishPointerDrawing);
    $('exampleTrackBtn').addEventListener('click', () => {
        setDrawingMode(false);
        path = examplePath.map(point => ({
            ...point
        }));
        $('drawHint').textContent = 'Example track loaded. You can run it or draw a custom path.';
        resetSensorRobot();
    });
    $('clearTrackBtn').addEventListener('click', () => {
        setDrawingMode(false);
        path = [];
        $('drawHint').textContent = 'Track cleared. Choose “Draw track” and draw a path before running the robot.';
        resetSensorRobot();
    });
    $('animateRobot').addEventListener('click', runSensorSimulation);
    $('resetRobot').addEventListener('click', resetSensorRobot);
    [sensorKp, sensorKi, sensorKd].forEach(el => el.addEventListener('input', updateSensorGains));
    sensorController.addEventListener('change', updateSensorGains);
    sensorModel.addEventListener('change', () => {
        resetSensorRobot();
        const n = sensorWeights[sensorModel.value].length;
        $('trackCanvas').setAttribute('aria-label', `Animated line-following robot with ${n} sensor${n===1?'':'s'}`);
        updateSensorReadings();
        drawTrack();
    });
    if ('ResizeObserver' in window) {
        new ResizeObserver(() => {
            drawChart();
            drawTrack();
        }).observe(chart.parentElement);
    } else window.addEventListener('resize', () => {
        drawChart();
        drawTrack();
    });
    updateOutputs();
    runSimulation();
    updateSensorGains();
    resetSensorRobot();
})();
