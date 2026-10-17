(() => {
    const $ = (id) => document.getElementById(id);
    const API_BASE = (location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname)) ?
        'http://127.0.0.1:8000' : location.origin;
    const mint = '#65e6c4',
        orange = '#ffb36b',
        muted = '#9aa8bf',
        grid = '#273149';

    // Process model and PID calculations run in FastAPI.
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

    const linePidChart = $('linePidChart');
    const linePidCtx = linePidChart?.getContext('2d');
    let linePidResult = null;

    function drawResponseChart(canvas, context, data) {
        if (!canvas || !context) return;
        const {
            w,
            h
        } = fitCanvas(canvas, context);
        context.clearRect(0, 0, w, h);
        const pad = {
            l: 43,
            r: 12,
            t: 16,
            b: 31
        };
        const pw = w - pad.l - pad.r,
            ph = h - pad.t - pad.b;
        const maxY = Math.max(80, data ? Math.ceil(Math.max(...data.pv, ...data.sp) / 10) * 10 + 10 : 80);
        const sampleCount = data?.t?.length || 1;
        const x = i => pad.l + (i / Math.max(1, sampleCount - 1)) * pw;
        const y = v => pad.t + ph - (v / maxY) * ph;
        context.font = '10px DM Mono, monospace';
        context.lineWidth = 1;
        context.strokeStyle = grid;
        context.fillStyle = muted;
        for (let val = 0; val <= maxY; val += 20) {
            context.beginPath();
            context.moveTo(pad.l, y(val));
            context.lineTo(w - pad.r, y(val));
            context.stroke();
            context.textAlign = 'right';
            context.textBaseline = 'middle';
            context.fillText(String(val), pad.l - 9, y(val));
        }
        for (let i = 0; i <= 5; i++) {
            const xx = pad.l + pw * i / 5;
            context.beginPath();
            context.moveTo(xx, pad.t);
            context.lineTo(xx, pad.t + ph);
            context.stroke();
            context.textAlign = 'center';
            context.textBaseline = 'top';
            context.fillText(String(i * 200), xx, pad.t + ph + 9);
        }
        context.fillStyle = muted;
        context.textAlign = 'left';
        context.textBaseline = 'top';
        context.fillText('OUTPUT', pad.l, 0);
        context.textAlign = 'right';
        context.fillText('TIME', w - pad.r, h - 10);
        if (!data) return;
        const drawLine = (values, color, width, dash = []) => {
            context.beginPath();
            context.strokeStyle = color;
            context.lineWidth = width;
            context.setLineDash(dash);
            values.forEach((v, i) => i ? context.lineTo(x(i), y(v)) : context.moveTo(x(i), y(v)));
            context.stroke();
            context.setLineDash([]);
        };
        drawLine(data.sp, '#929db5', 1.5, [5, 5]);
        drawLine(data.pv, mint, 2.4);
        const opScaled = data.op.map(v => v * maxY / 100);
        drawLine(opScaled, orange, 1.2, [3, 4]);
    }

    function drawLinePidChart() {
        drawResponseChart(linePidChart, linePidCtx, linePidResult);
    }

    function renderLinePidMetrics() {
        if (!linePidResult) return;
        $('linePidIae').textContent = linePidResult.iae.toLocaleString(undefined, {
            maximumFractionDigits: 1
        });
        $('linePidOvershoot').textContent = linePidResult.overshoot.toFixed(1) + '%';
        $('linePidSettling').textContent = linePidResult.settling == null ? 'Not settled' : Math.round(linePidResult.settling) + ' s';
        $('linePidSampleCount').textContent = linePidResult.t.length + ' samples';
    }

    function readLinePidSettings() {
        const controller = sensorController.value;
        return {
            kc: controller === 'PID Ratio' ? +sensorRatio.value : +sensorKp.value,
            ti: +sensorTi.value,
            td: +sensorTd.value,
            target: +$('lineTarget').value,
            controller
        };
    }

    async function runLinePidSimulation() {
        $('lineTargetOut').value = $('lineTarget').value;
        $('animateRobot').disabled = true;
        $('linePidRunStatus').textContent = 'CALCULATING…';
        try {
            linePidResult = await simulate(readLinePidSettings());
            drawLinePidChart();
            renderLinePidMetrics();
            $('linePidRunStatus').textContent = 'SIMULATION COMPLETE';
        } catch (error) {
            $('linePidRunStatus').textContent = 'API ERROR';
            $('linePidIae').textContent = '—';
            $('linePidOvershoot').textContent = '—';
            $('linePidSettling').textContent = '—';
            $('linePidSampleCount').textContent = error.message || 'Could not reach API';
        } finally {
            if (environmentMode === 'pid') $('animateRobot').disabled = false;
        }
    }

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
        sensorTi = $('sensorTi'),
        sensorTd = $('sensorTd'),
        sensorRatio = $('sensorRatio');
    const sensorController = $('sensorController');
    const sensorModel = $('sensorModel');
    const sensorWeights = {
        '7': [-3, -2, -1, 0, 1, 2, 3],
        '5': [-2, -1, 0, 1, 2],
        '2': [-1, 1]
    };
    const sensorModelApi = {
        '7': 'seven',
        '5': 'five',
        '2': 'two'
    };
    let environmentMode = 'pid';
    const lineTarget = $('lineTarget');
    let telemetryHistory = [];
    let lastSimulationMetrics = {};

    function controllerGains() {
        const kp = Number(sensorKp.value);
        const controller = sensorController.value;
        if (controller === 'PID Ratio') return { kp: Number(sensorRatio.value), ki: 0, kd: 0 };
        const ti = Math.max(1, Number(sensorTi.value));
        const td = Number(sensorTd.value);
        return {
            kp,
            ki: controller === 'PID' ? kp / ti : 0,
            kd: (controller === 'PD' || controller === 'PID') ? Math.min(100, kp * td) : 0
        };
    }

    function updateSensorGains() {
        $('sensorKpOut').value = (+sensorKp.value).toFixed(1);
        $('sensorTiOut').value = sensorTi.value;
        $('sensorTdOut').value = (+sensorTd.value).toFixed(1);
        $('sensorRatioOut').value = (+sensorRatio.value).toFixed(1);
        $('lineTargetOut').value = lineTarget.value;
        const controllerMode = sensorController.value;
        $('sensorTiGroup').hidden = controllerMode !== 'PID';
        $('sensorTdGroup').hidden = !(controllerMode === 'PD' || controllerMode === 'PID');
        $('ratioGroup').hidden = controllerMode !== 'PID Ratio';
        $('kpGroup').hidden = controllerMode === 'PID Ratio';
        const hints = {
            P: 'P reacts to current error only. Increase Kp for a faster response; too much can cause overshoot or oscillation.',
            PD: 'PD adds damping via Tau_D. Useful when proportional action alone overshoots or hunts.',
            PID: 'PID combines current, accumulated, and changing error. Tau_I and Tau_D control integral and derivative time constants.',
            'PID Ratio': 'PID Ratio uses a single gain on error—the same ratio-style control used in the line-following scripts.'
        };
        const modeNote = environmentMode === 'pid'
            ? ' Switch to Sensor or Path mode to run the line follower with these settings.'
            : '';
        $('controllerHint').textContent = hints[controllerMode] + modeNote;
        if (environmentMode === 'pid') $('linePidRunStatus').textContent = 'PARAMETERS CHANGED';
    }

    function setEnvironment(mode) {
        environmentMode = mode;
        const pid = mode === 'pid';
        const sensor = mode === 'sensor';
        $('pidEnvironmentTab').classList.toggle('active', pid);
        $('sensorEnvironmentTab').classList.toggle('active', sensor);
        $('pathEnvironmentTab').classList.toggle('active', mode === 'path');
        $('pidEnvironmentTab').setAttribute('aria-selected', String(pid));
        $('sensorEnvironmentTab').setAttribute('aria-selected', String(sensor));
        $('pathEnvironmentTab').setAttribute('aria-selected', String(mode === 'path'));
        $('pidTuningView').hidden = !pid;
        $('trackSimulationView').hidden = pid;
        $('lineTelemetryPanel').hidden = pid;
        $('sensorModelGroup').hidden = !sensor;
        $('pidTargetGroup').hidden = !pid;
        if (pid) {
            $('environmentTitle').textContent = 'PID tuning';
            $('environmentDescription').textContent = 'Adjust proportional, integral, and derivative action against a first-order process with dead time. When the response looks good, switch to sensor or path mode and run the line follower with the same gains.';
            $('animateRobot').innerHTML = 'Run simulation <i class="fa-solid fa-play" aria-hidden="true"></i>';
            $('animateRobot').disabled = false;
            updateSensorGains();
            drawLinePidChart();
        } else if (sensor) {
            $('environmentTitle').textContent = 'Sensor based control';
            $('environmentDescription').textContent = 'The vehicle only sees the line through its sensors. If all sensors lose the line, it cannot directly calculate its distance from the track.';
            resetSensorRobot();
            drawTelemetryChart();
        } else {
            $('environmentTitle').textContent = 'Path-aware control';
            $('environmentDescription').textContent = 'The vehicle knows the track geometry. It estimates cross-track error and can steer back toward the nearest point on the path even after drifting away.';
            resetSensorRobot();
            drawTelemetryChart();
        }
        updateSensorGains();
    }

    function updateSensorReadings() {
        const bars = $('sensorBars').querySelectorAll('i');
        bars.forEach((bar, i) => {
            bar.hidden = i >= robot.sensors.length || environmentMode !== 'sensor';
            bar.classList.toggle('active', !!robot.sensors[i]);
        });
        $('sensorReadoutLabel').textContent = environmentMode === 'sensor'
            ? 'SENSOR ARRAY · ' + robot.sensors.length : 'PATH GEOMETRY';
        $('errorReadout').textContent = (environmentMode === 'sensor' ? 'SENSOR ERROR: ' : 'CROSS-TRACK: ') + Number(robot.error || 0).toFixed(2);
    }

    function drawTelemetryChart() {
        const canvas = $('lineTelemetryChart');
        if (!canvas) return;
        const context = canvas.getContext('2d');
        const {w, h} = fitCanvas(canvas, context);
        context.clearRect(0, 0, w, h);
        context.fillStyle = '#0d1525'; context.fillRect(0, 0, w, h);
        const left = 42, right = 12, top = 14, bottom = 28;
        const plotW = w - left - right, plotH = h - top - bottom;
        context.font = '10px "DM Mono", monospace'; context.fillStyle = '#9aa8bf';
        context.strokeStyle = '#273149'; context.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = top + plotH * i / 4;
            context.beginPath(); context.moveTo(left, y); context.lineTo(w-right, y); context.stroke();
            context.fillText((2 - i).toString(), 10, y + 3);
        }
        context.fillText('time →', w - 52, h - 7);
        const history = telemetryHistory.slice(-180);
        if (history.length < 2) {
            context.fillText('Run a simulation to plot live telemetry', left + 8, top + plotH / 2);
            return;
        }
        const drawSeries = (key, color, scale) => {
            const vals = history.map(d => Number(d[key] || 0));
            const maxAbs = Math.max(1, ...vals.map(Math.abs));
            context.strokeStyle = color; context.lineWidth = 1.8; context.beginPath();
            vals.forEach((value, i) => {
                const x = left + plotW * i / (vals.length - 1);
                const y = top + plotH / 2 - (value / maxAbs) * plotH * .43;
                if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            context.stroke();
        };
        drawSeries('error', '#65e6c4');
        drawSeries('output', '#ffb36b');
    }

    function drawTrack() {
        const { w, h } = fitCanvas(track, tctx);
        tctx.clearRect(0, 0, w, h);

        // Drawing-area visual only: dark plotting surface, subtle grid, clean
        // mint path, start marker, robot trail, and the existing vehicle/sensors.
        // The hero illustration and all drawing controls remain untouched.
        tctx.fillStyle = '#0b1220';
        tctx.fillRect(0, 0, w, h);
        tctx.strokeStyle = '#1b2940';
        tctx.lineWidth = 1;
        for (let xx = 0; xx <= w; xx += 30) {
            tctx.beginPath(); tctx.moveTo(xx, 0); tctx.lineTo(xx, h); tctx.stroke();
        }
        for (let yy = 0; yy <= h; yy += 30) {
            tctx.beginPath(); tctx.moveTo(0, yy); tctx.lineTo(w, yy); tctx.stroke();
        }

        const pts = path.map(p => ({ x: p.x * w, y: p.y * h }));
        if (pts.length > 1) {
            // A restrained glow gives the path definition without the heavy road
            // border used in the previous drawing area.
            tctx.save();
            tctx.lineCap = 'round';
            tctx.lineJoin = 'round';
            tctx.strokeStyle = 'rgba(101, 230, 196, 0.12)';
            tctx.lineWidth = 12;
            tctx.beginPath();
            pts.forEach((point, i) => i ? tctx.lineTo(point.x, point.y) : tctx.moveTo(point.x, point.y));
            tctx.stroke();
            tctx.strokeStyle = '#65e6c4';
            tctx.lineWidth = 3;
            tctx.beginPath();
            pts.forEach((point, i) => i ? tctx.lineTo(point.x, point.y) : tctx.moveTo(point.x, point.y));
            tctx.stroke();
            tctx.restore();

            // Mark the path start so the vehicle's initial position is obvious.
            tctx.fillStyle = '#102d2b';
            tctx.beginPath(); tctx.arc(pts[0].x, pts[0].y, 8, 0, Math.PI * 2); tctx.fill();
            tctx.strokeStyle = '#65e6c4'; tctx.lineWidth = 1.25;
            tctx.beginPath(); tctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2); tctx.stroke();
        } else if (pts.length === 1) {
            tctx.fillStyle = '#65e6c4';
            tctx.beginPath(); tctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2); tctx.fill();
        }

        // Show the traveled route in orange while animating.
        if (sensorFrames.length > 1 && sensorFrameIndex > 1) {
            const trail = sensorFrames.slice(0, sensorFrameIndex).map(frame => ({ x: frame.x * w, y: frame.y * h }));
            tctx.save();
            tctx.strokeStyle = 'rgba(255, 179, 107, 0.8)';
            tctx.lineWidth = 1.8;
            tctx.lineCap = 'round';
            tctx.lineJoin = 'round';
            tctx.beginPath();
            trail.forEach((point, i) => i ? tctx.lineTo(point.x, point.y) : tctx.moveTo(point.x, point.y));
            tctx.stroke();
            tctx.restore();
        }

        if (drawingEnabled) {
            updateSensorReadings();
            return;
        }

        const weights = sensorWeights[sensorModel.value] || sensorWeights['7'];
        const forward = { x: Math.cos(robot.heading), y: Math.sin(robot.heading) };
        const normal = { x: -forward.y, y: forward.x };
        const cx = robot.x * w, cy = robot.y * h;
        tctx.save();
        tctx.translate(cx, cy);
        tctx.rotate(robot.heading);
        // Vehicle body.
        tctx.fillStyle = '#65e6c4';
        tctx.strokeStyle = '#c1fff0';
        tctx.lineWidth = 1.5;
        tctx.beginPath(); tctx.roundRect(-15, -10, 30, 20, 5); tctx.fill(); tctx.stroke();
        // Forward marker.
        tctx.fillStyle = '#0b1220';
        tctx.beginPath(); tctx.moveTo(9, 0); tctx.lineTo(2, -4); tctx.lineTo(2, 4); tctx.closePath(); tctx.fill();
        tctx.restore();

        const sensorX = cx + forward.x * 13, sensorY = cy + forward.y * 13;
        if (environmentMode === 'sensor') {
            weights.forEach((weight, i) => {
                const x = sensorX + normal.x * weight * 5.2;
                const y = sensorY + normal.y * weight * 5.2;
                tctx.beginPath(); tctx.arc(x, y, 3.1, 0, Math.PI * 2);
                tctx.fillStyle = robot.sensors[i] ? '#65e6c4' : '#53617a';
                tctx.fill();
                tctx.strokeStyle = '#0b1220'; tctx.lineWidth = .7; tctx.stroke();
            });
        }
        updateSensorReadings();
    }

    function resetSensorRobot() {
        requestToken++;
        robot.running = false;
        cancelAnimationFrame(animationFrame);
        sensorFrames = [];
        sensorFrameIndex = 0;
        telemetryHistory = [];
        lastSimulationMetrics = {};
        $('lineErrorMetric').textContent = '—';
        $('lineOutputMetric').textContent = '—';
        $('lineStepsMetric').textContent = '0';
        $('lineLostMetric').textContent = '0';
        $('linePlotStatus').textContent = 'READY TO RUN';
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
                x: 0.5,
                y: 0.5,
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
        $('animateRobot').disabled = environmentMode === 'pid' ? false : (drawingEnabled || path.length < 2);
        if (environmentMode !== 'pid') {
            $('animateRobot').innerHTML = 'Run simulation <i class="fa-solid fa-play" aria-hidden="true"></i>';
        }
        updateSensorReadings();
        drawTrack();
        drawTelemetryChart();
    }

    function animateSensorFrames(token) {
        if (token !== requestToken || !robot.running) return;
        if (sensorFrameIndex >= sensorFrames.length) {
            robot.running = false;
            $('robotState').textContent = 'COMPLETE';
            $('linePlotStatus').textContent = 'SIMULATION COMPLETE';
            $('lineLostMetric').textContent = String(lastSimulationMetrics.lost_line_steps ?? lastSimulationMetrics.lost_track_steps ?? 0);
            $('animateRobot').innerHTML = 'Run again <i class="fa-solid fa-play" aria-hidden="true"></i>';
            return;
        }
        const frame = sensorFrames[sensorFrameIndex++];
        robot = {
            ...robot,
            ...frame,
            running: true,
            step: frame.step,
            sensors: frame.sensors || robot.sensors || []
        };
        telemetryHistory.push({ error: Number(frame.error ?? frame.cross_track_error ?? 0), output: Number(frame.steering ?? 0) });
        $('lineErrorMetric').textContent = Number(frame.error ?? frame.cross_track_error ?? 0).toFixed(3);
        $('lineOutputMetric').textContent = Number(frame.steering ?? 0).toFixed(4);
        $('lineStepsMetric').textContent = String(frame.step ?? sensorFrameIndex);
        $('linePlotStatus').textContent = 'RUNNING';
        drawTrack();
        drawTelemetryChart();
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
        telemetryHistory = [];
        lastSimulationMetrics = {};
        $('lineErrorMetric').textContent = '—'; $('lineOutputMetric').textContent = '—';
        $('lineStepsMetric').textContent = '0'; $('lineLostMetric').textContent = '0';
        $('linePlotStatus').textContent = 'CALCULATING…';
        $('robotState').textContent = 'CALCULATING';
        $('animateRobot').disabled = true;
        $('animateRobot').innerHTML = 'Calculating… <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
        const {w, h} = fitCanvas(track, tctx);
        const gains = controllerGains();
        const controller = sensorController.value;
        const payload = {
            path,
            sensor_model: sensorModelApi[sensorModel.value],
            controller,
            pid: gains,
            canvas_width: Math.max(120, Math.round(w)),
            canvas_height: Math.max(120, Math.round(h)),
            speed: 1.45,
            max_steps: 2200
        };
        try {
            let data;
            if (environmentMode === 'sensor') {
                data = await requestJSON(`${API_BASE}/api/sensor-simulate`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
                }, 'Sensor simulation request failed.');
            } else {
                const pixelPath = path.map(point => ({x: point.x * w, y: point.y * h}));
                data = await requestJSON(`${API_BASE}/api/simulate`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({path: pixelPath, pid: gains, speed: 2, max_steps: 2200, lookahead: 24})
                }, 'Path-aware simulation request failed.');
                data.frames = (data.frames || []).map(frame => ({
                    ...frame, x: frame.x / w, y: frame.y / h,
                    error: frame.cross_track_error ?? frame.error,
                    sensors: []
                }));
            }
            if (token !== requestToken) return;
            sensorFrames = data.frames || [];
            lastSimulationMetrics = data.metrics || {};
            if (!sensorFrames.length) throw new Error('The backend returned no simulation frames.');
            $('lineLostMetric').textContent = String(lastSimulationMetrics.lost_line_steps ?? lastSimulationMetrics.lost_track_steps ?? 0);
            sensorFrameIndex = 0;
            $('robotState').textContent = 'RUNNING';
            $('linePlotStatus').textContent = 'RUNNING';
            $('animateRobot').innerHTML = 'Running… <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
            robot.running = true;
            animateSensorFrames(token);
        } catch (error) {
            if (token !== requestToken) return;
            $('robotState').textContent = 'API ERROR';
            $('linePlotStatus').textContent = 'API ERROR';
            $('animateRobot').innerHTML = 'Retry simulation <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
            $('environmentDescription').textContent = `Simulation failed: ${error.message}. Check that FastAPI is running and the API URL is correct.`;
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
    function runLineFollowerAction() {
        if (environmentMode === 'pid') runLinePidSimulation();
        else runSensorSimulation();
    }

    function resetLineFollower() {
        if (environmentMode === 'pid') {
            sensorKp.value = 5;
            sensorTi.value = 60;
            sensorTd.value = 7;
            lineTarget.value = 60;
            updateSensorGains();
            runLinePidSimulation();
            return;
        }
        resetSensorRobot();
    }

    $('animateRobot').addEventListener('click', runLineFollowerAction);
    $('resetRobot').addEventListener('click', resetLineFollower);
    [sensorKp, sensorTi, sensorTd, sensorRatio, lineTarget].forEach(el => el.addEventListener('input', updateSensorGains));
    sensorController.addEventListener('change', updateSensorGains);
    $('pidEnvironmentTab').addEventListener('click', () => setEnvironment('pid'));
    $('sensorEnvironmentTab').addEventListener('click', () => setEnvironment('sensor'));
    $('pathEnvironmentTab').addEventListener('click', () => setEnvironment('path'));
    sensorModel.addEventListener('change', () => {
        resetSensorRobot();
        const n = sensorWeights[sensorModel.value].length;
        $('trackCanvas').setAttribute('aria-label', `Animated line-following robot with ${n} sensors`);
        updateSensorReadings();
        drawTrack();
    });
    linePidChart?.addEventListener('mousemove', event => {
        if (!linePidResult) return;
        const rect = linePidChart.getBoundingClientRect(),
            xPos = event.clientX - rect.left;
        const index = Math.max(0, Math.min(1000, Math.round((xPos - 43) / Math.max(1, rect.width - 55) * 1000)));
        const tip = $('linePidTooltip');
        tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(rect.width - 140, xPos + 12)) + 'px';
        tip.style.top = '12px';
        tip.textContent = `t = ${linePidResult.t[index].toFixed(0)} · SP = ${linePidResult.sp[index].toFixed(1)} · PV = ${linePidResult.pv[index].toFixed(2)} · Output = ${linePidResult.op[index].toFixed(1)}%`;
    });
    linePidChart?.addEventListener('mouseleave', () => {
        $('linePidTooltip').hidden = true;
    });

    if ('ResizeObserver' in window) {
        const redrawViews = () => {
            drawLinePidChart();
            drawTrack();
            drawTelemetryChart();
        };
        if (linePidChart?.parentElement) new ResizeObserver(redrawViews).observe(linePidChart.parentElement);
        if (track?.parentElement) new ResizeObserver(redrawViews).observe(track.parentElement);
    } else window.addEventListener('resize', () => {
        drawLinePidChart();
        drawTrack();
        drawTelemetryChart();
    });
    updateSensorGains();
    setEnvironment('pid');
    runLinePidSimulation();
    if (path.length >= 2) {
        const a = path[0], b = path[1];
        robot.heading = Math.atan2((b.y - a.y) * track.height, (b.x - a.x) * track.width);
    }
})();
