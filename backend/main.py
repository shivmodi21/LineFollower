"""FastAPI backend for the LineFollower PID playground.

Provides the original geometric path-following API and a server-side
sensor-based line-following simulation with selectable sensor configurations.
"""
from __future__ import annotations

import math
from typing import Literal
from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

app = FastAPI(
    title="LineFollower PID API",
    description="Geometric path following and sensor-based line-following simulations.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

DEFAULT_PID = {"kp": 5.0, "ki": 0.0, "kd": 0.0}
SENSOR_WEIGHTS = {
    "seven": [-3, -2, -1, 0, 1, 2, 3],
    "five": [-2, -1, 0, 1, 2],
    "two": [-1, 1],
}


class Point(BaseModel):
    x: float = Field(ge=0, le=2000)
    y: float = Field(ge=0, le=2000)


class PIDGains(BaseModel):
    kp: float = Field(default=5.0, ge=0.0, le=100.0)
    ki: float = Field(default=0.0, ge=0.0, le=100.0)
    kd: float = Field(default=0.0, ge=0.0, le=100.0)


class SimulationRequest(BaseModel):
    path: list[Point] = Field(min_length=2, max_length=2000)
    pid: PIDGains = Field(default_factory=PIDGains)
    speed: float = Field(default=2.0, gt=0.1, le=10.0)
    max_steps: int = Field(default=1800, ge=1, le=5000)
    lookahead: float = Field(default=24.0, ge=5.0, le=100.0)

    @model_validator(mode="after")
    def path_must_have_length(self):
        if not any(math.hypot(p.x - self.path[0].x, p.y - self.path[0].y) > 1 for p in self.path[1:]):
            raise ValueError("The path must contain at least two distinct points.")
        return self


class SensorSimulationRequest(BaseModel):
    # Normalized points keep the API independent of browser canvas dimensions.
    path: list[Point] = Field(min_length=2, max_length=2000)
    sensor_model: Literal["seven", "five", "two"] = "seven"
    controller: Literal["P", "PD", "PID", "PID Ratio"] = "PID"
    pid: PIDGains = Field(default_factory=PIDGains)
    canvas_width: int = Field(default=640, ge=120, le=2000)
    canvas_height: int = Field(default=360, ge=120, le=2000)
    speed: float = Field(default=1.45, gt=0.1, le=5.0)
    max_steps: int = Field(default=2200, ge=1, le=5000)

    @model_validator(mode="after")
    def validate_normalized_path(self):
        if not any(math.hypot(p.x - self.path[0].x, p.y - self.path[0].y) > 0.005 for p in self.path[1:]):
            raise ValueError("The path must contain at least two distinct points.")
        if any(p.x > 1 or p.y > 1 for p in self.path):
            raise ValueError("Sensor simulation path coordinates must be normalized between 0 and 1.")
        return self



class ProcessPIDRequest(BaseModel):
    """Parameters for the first-order process PID experiment."""
    kc: float = Field(default=5.0, ge=0.1, le=15.0)
    ti: float = Field(default=60.0, ge=5.0, le=180.0)
    td: float = Field(default=7.0, ge=0.0, le=30.0)
    target: float = Field(default=60.0, ge=25.0, le=80.0)
    controller: Literal["P", "PD", "PID", "PID Ratio"] = "PID"
    samples: int = Field(default=1001, ge=101, le=2001)



def _distance(a: Point, b: Point) -> float:
    return math.hypot(b.x - a.x, b.y - a.y)


def _project_onto_segment(px: float, py: float, a: Point, b: Point):
    dx, dy = b.x - a.x, b.y - a.y
    length_sq = dx * dx + dy * dy
    if length_sq < 1e-9:
        return a.x, a.y, 0.0
    t = max(0.0, min(1.0, ((px - a.x) * dx + (py - a.y) * dy) / length_sq))
    return a.x + t * dx, a.y + t * dy, t


def _nearest_path_location(x: float, y: float, path: list[Point]):
    best, best_distance = None, float("inf")
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        qx, qy, t = _project_onto_segment(x, y, a, b)
        distance = math.hypot(x - qx, y - qy)
        if distance < best_distance:
            best_distance, best = distance, (i, qx, qy, t, distance)
    return best


def _point_ahead(path: list[Point], segment_index: int, t: float, lookahead: float):
    i = segment_index
    a, b = path[i], path[i + 1]
    remaining = _distance(Point(x=a.x + t * (b.x - a.x), y=a.y + t * (b.y - a.y)), b)
    if remaining >= lookahead:
        length = _distance(a, b)
        next_t = min(1.0, t + lookahead / max(length, 1e-9))
        return a.x + next_t * (b.x - a.x), a.y + next_t * (b.y - a.y)
    distance_left = lookahead - remaining
    i += 1
    while i < len(path) - 1:
        a, b = path[i], path[i + 1]
        length = _distance(a, b)
        if length >= distance_left:
            ratio = distance_left / max(length, 1e-9)
            return a.x + ratio * (b.x - a.x), a.y + ratio * (b.y - a.y)
        distance_left -= length
        i += 1
    return path[-1].x, path[-1].y


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2 * math.pi) - math.pi


def _point_segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den)) if den else 0.0
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


@app.get("/")
def root():
    """Serve the frontend on the same origin in production, when available."""
    index_file = Path(__file__).resolve().parent.parent / "frontend" / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return {"name": "LineFollower PID API", "status": "ok", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/defaults")
def defaults():
    return {
        "pid": DEFAULT_PID,
        "speed": 2.0,
        "max_steps": 1800,
        "lookahead": 24.0,
        "controller_mode": "P",
        "sensor_models": list(SENSOR_WEIGHTS),
        "note": "Sensor simulations run on the backend; the browser animates returned frames.",
    }


@app.post("/api/simulate")
def simulate(request: SimulationRequest):
    """Existing geometric path-following simulation (preserved)."""
    path = request.path
    total_length = sum(_distance(path[i], path[i + 1]) for i in range(len(path) - 1))
    if total_length < 10:
        raise HTTPException(status_code=422, detail="Please draw a longer path before starting.")
    start_segment = next((i for i in range(len(path) - 1) if _distance(path[i], path[i + 1]) > 1), None)
    if start_segment is None:
        raise HTTPException(status_code=422, detail="The path must contain a usable segment.")
    x, y = path[0].x, path[0].y
    first, second = path[start_segment], path[start_segment + 1]
    heading = math.atan2(second.y - first.y, second.x - first.x)
    integral = previous_error = 0.0
    frames, errors = [], []
    lost_steps = 0
    end_tolerance = max(12.0, request.lookahead * 0.65)
    for step in range(request.max_steps):
        nearest = _nearest_path_location(x, y, path)
        segment_index, qx, qy, t, distance = nearest
        a, b = path[segment_index], path[segment_index + 1]
        tx, ty = b.x - a.x, b.y - a.y
        length = max(math.hypot(tx, ty), 1e-9)
        tx, ty = tx / length, ty / length
        cross = tx * (y - qy) - ty * (x - qx)
        error = -cross / 30.0
        integral = max(-20.0, min(20.0, integral + error))
        derivative = error - previous_error
        output = request.pid.kp * error + request.pid.ki * integral + request.pid.kd * derivative
        target_x, target_y = _point_ahead(path, segment_index, t, request.lookahead)
        heading_error = _wrap_angle(math.atan2(target_y - y, target_x - x) - heading)
        steering = max(-0.35, min(0.35, 0.7 * heading_error + 0.08 * output))
        heading = _wrap_angle(heading + steering)
        x += math.cos(heading) * request.speed
        y += math.sin(heading) * request.speed
        previous_error = error
        errors.append(abs(error) * 30.0)
        if distance > 90:
            lost_steps += 1
        if step % 2 == 0 or step == request.max_steps - 1:
            frames.append({"x": round(x, 3), "y": round(y, 3), "heading": round(heading, 5),
                           "error": round(error, 4), "cross_track_error": round(distance, 3),
                           "steering": round(steering, 5), "step": step + 1})
        # Stop when the vehicle has reached the final waypoint. The old check
        # could miss the endpoint when the vehicle overshot it between steps.
        reached_endpoint = math.hypot(x - path[-1].x, y - path[-1].y) <= max(end_tolerance, request.speed * 2.5)
        if reached_endpoint and step > 10:
            if not frames or frames[-1]["step"] != step + 1:
                frames.append({"x": round(x, 3), "y": round(y, 3), "heading": round(heading, 5),
                               "error": round(error, 4), "cross_track_error": round(distance, 3),
                               "steering": round(steering, 5), "step": step + 1})
            break
    return {"frames": frames, "metrics": {
        "steps": step + 1, "frames": len(frames),
        "mean_absolute_error_px": round(sum(errors) / max(len(errors), 1), 3),
        "max_error_px": round(max(errors, default=0.0), 3),
        "lost_track_steps": lost_steps,
        "reached_endpoint": math.hypot(x - path[-1].x, y - path[-1].y) <= max(end_tolerance, request.speed * 2.5),
    }, "pid": request.pid.model_dump()}


@app.post("/api/sensor-simulate")
def sensor_simulate(request: SensorSimulationRequest):
    """Run sensor sampling and controller calculations server-side.

    The frontend only renders the returned frames. Sensor geometry is evaluated
    in canvas pixels while positions in the request/response remain normalized.
    """
    path = request.path
    width, height = request.canvas_width, request.canvas_height
    weights = SENSOR_WEIGHTS[request.sensor_model]
    first_segment = next((i for i in range(len(path) - 1) if _distance(path[i], path[i + 1]) > 0.001), None)
    if first_segment is None:
        raise HTTPException(status_code=422, detail="The track needs at least one non-zero segment.")

    x, y = path[0].x, path[0].y
    a, b = path[first_segment], path[first_segment + 1]
    heading = math.atan2((b.y - a.y) * height, (b.x - a.x) * width)
    integral = previous_error = 0.0
    frames = []
    lost_line_steps = 0
    speed = request.speed

    def sample_sensors(rx, ry, angle, prev_error):
        px, py = rx * width, ry * height
        forward_x, forward_y = math.cos(angle), math.sin(angle)
        normal_x, normal_y = -forward_y, forward_x
        sx, sy = px + forward_x * 13.0, py + forward_y * 13.0
        detected = []
        for weight in weights:
            sx_i, sy_i = sx + normal_x * weight * 5.2, sy + normal_y * weight * 5.2
            nearest = min(
                _point_segment_distance(sx_i, sy_i, path[i].x * width, path[i].y * height,
                                        path[i + 1].x * width, path[i + 1].y * height)
                for i in range(len(path) - 1)
            )
            detected.append(nearest <= 5.5)
        active = sum(detected)
        if request.sensor_model == "two":
            if detected[0] and detected[1]: error = 0.0
            elif detected[0]: error = -1.8
            elif detected[1]: error = 1.8
            else: error = 0.0 if prev_error == 0 else math.copysign(2.8, prev_error)
        elif active == 0:
            error = 0.0 if prev_error == 0 else math.copysign(3.0, prev_error)
        else:
            error = sum(w for w, on in zip(weights, detected) if on) / active
        return detected, error, (forward_x, forward_y, normal_x, normal_y)

    for step in range(request.max_steps):
        detected, error, vectors = sample_sensors(x, y, heading, previous_error)
        integral = max(-20.0, min(20.0, integral + error))
        derivative = error - previous_error
        p_term = request.pid.kp * error
        i_term = request.pid.ki * integral if request.controller == "PID" else 0.0
        d_term = request.pid.kd * derivative if request.controller in ("PD", "PID") else 0.0
        if request.controller == "PID Ratio":
            i_term = d_term = 0.0
        output = p_term + i_term + d_term
        steering = max(-0.18, min(0.18, output * 0.012))
        heading = _wrap_angle(heading + steering)
        x += math.cos(heading) * speed / width
        y += math.sin(heading) * speed / height
        previous_error = error
        if not any(detected):
            lost_line_steps += 1
        # Keep the endpoint check independent of sensor detection: the vehicle
        # should stop at the drawn path's end instead of driving until canvas edge.
        endpoint_distance_px = math.hypot((x - path[-1].x) * width, (y - path[-1].y) * height)
        reached_endpoint = endpoint_distance_px <= 15.0 and step > 8
        frames.append({"x": round(x, 6), "y": round(y, 6), "heading": round(heading, 5),
                       "error": round(error, 4), "sensors": detected, "steering": round(steering, 5),
                       "step": step + 1})
        if reached_endpoint or x < -0.02 or x > 1.02 or y < -0.02 or y > 1.02:
            break

    return {"sensor_model": request.sensor_model, "controller": request.controller,
            "pid": request.pid.model_dump(), "frames": frames,
            "metrics": {"steps": len(frames), "frames": len(frames), "lost_line_steps": lost_line_steps,
                        "reached_endpoint": bool(frames and math.hypot((frames[-1]["x"] - path[-1].x) * width,
                                                                        (frames[-1]["y"] - path[-1].y) * height) <= 15.0),
                        "stopped_at_boundary": bool(frames and (frames[-1]["x"] < -0.02 or frames[-1]["x"] > 1.02 or frames[-1]["y"] < -0.02 or frames[-1]["y"] > 1.02))}}


@app.post("/api/pid-process")
def pid_process(request: ProcessPIDRequest):
    """Run the first-order process response experiment on the backend.

    This follows the model used in the project's pid_tuning.py: process gain
    0.9, process time constant 175, nominal PV 23, output delay 15, and
    controller output constrained to 0..100 with integral anti-windup.
    """
    n = request.samples
    tf = 1000.0
    dt = tf / (n - 1)
    process_gain, tau_p, delay = 0.9, 175.0, 15.0
    delay_steps = max(0, round(delay / dt))
    t, sp, pv, op = [], [], [], []
    p_term, i_term, d_term = [], [], []
    y, integral, previous_pv, iae = 23.0, 0.0, 23.0, 0.0

    for index in range(n):
        time = index * dt
        t.append(time)
        sp.append(request.target)
        if index > 0:
            delayed_index = max(0, index - delay_steps)
            delayed_output = op[delayed_index] if delayed_index < len(op) else 0.0
            y += dt * (-(y - 23.0) + process_gain * delayed_output) / tau_p
        pv.append(y)
        error = request.target - y
        iae += abs(error) * dt
        p = request.kc * error
        d = (
            -request.kc * request.td * ((y - previous_pv) / dt)
            if request.controller in ("PD", "PID")
            else 0.0
        )
        if request.controller == "PID":
            proposed_integral = integral + (request.kc / request.ti) * error * dt
            output = p + proposed_integral + d
        elif request.controller in ("P", "PID Ratio"):
            proposed_integral = integral
            output = p
        else:
            proposed_integral = integral
            output = p + d
        if output > 100.0:
            output = 100.0
        elif output < 0.0:
            output = 0.0
        else:
            integral = proposed_integral
        p_term.append(p)
        i_term.append(integral)
        d_term.append(d)
        op.append(output)
        previous_pv = y

    peak = max(pv)
    overshoot = max(0.0, (peak - request.target) / max(1.0, request.target - 23.0) * 100.0)
    band = max(1.0, abs(request.target) * 0.02)
    settling = None
    # Find the first sample after which PV stays inside the settling band.
    outside_count = 0
    for idx in range(n - 1, -1, -1):
        if abs(pv[idx] - request.target) > band:
            outside_count = idx + 1
            break
    if outside_count < n:
        settling = t[outside_count] if outside_count < n else None
    return {
        "t": t, "sp": sp, "pv": pv, "op": op,
        "p_term": p_term, "i_term": i_term, "d_term": d_term,
        "iae": round(iae, 6), "overshoot": round(overshoot, 6),
        "settling": settling, "target": request.target,
        "parameters": request.model_dump(),
        "model": {"process_gain": process_gain, "time_constant": tau_p,
                  "dead_time": delay, "nominal_value": 23.0}
    }


# Serve CSS and JavaScript from the same Render service as the API. This keeps
# API_BASE=location.origin valid for the recommended single-service deployment.
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
