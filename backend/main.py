import math
from typing import Annotated

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

app = FastAPI(
    title="LineFollower PID API",
    description="API for simulating a line-following robot with configurable PID gains.",
    version="0.1.0",
)

# Allow the frontend to run on a different local port during development.
# In production, the frontend and API can be served by the same Render service.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

DEFAULT_PID = {"kp": 5.0, "ki": 0.0, "kd": 0.0}


class Point(BaseModel):
    x: float = Field(ge=0, le=2000)
    y: float = Field(ge=0, le=2000)


class PIDGains(BaseModel):
    # Kp=5 preserves the original proportional steering ratio as the starting point.
    kp: float = Field(default=5.0, ge=0.0, le=100.0)
    ki: float = Field(default=0.0, ge=0.0, le=100.0)
    kd: float = Field(default=0.0, ge=0.0, le=100.0)


class SimulationRequest(BaseModel):
    path: list[Point] = Field(min_length=2, max_length=2000)
    pid: PIDGains = Field(default_factory=PIDGains)
    speed: float = Field(default=2.0, gt=0.1, le=10.0, description="Distance travelled per simulation step")
    max_steps: int = Field(default=1800, ge=1, le=5000)
    lookahead: float = Field(default=24.0, ge=5.0, le=100.0)

    @model_validator(mode="after")
    def path_must_have_length(self):
        distinct = any(
            math.hypot(self.path[i].x - self.path[0].x, self.path[i].y - self.path[0].y) > 1
            for i in range(1, len(self.path))
        )
        if not distinct:
            raise ValueError("The path must contain at least two distinct points.")
        return self


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
    best = None
    best_distance = float("inf")
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        qx, qy, t = _project_onto_segment(x, y, a, b)
        distance = math.hypot(x - qx, y - qy)
        if distance < best_distance:
            best_distance = distance
            best = (i, qx, qy, t, distance)
    return best


def _point_ahead(path: list[Point], segment_index: int, t: float, lookahead: float):
    """Find a point approximately lookahead pixels farther along the polyline."""
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
    last = path[-1]
    return last.x, last.y


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2 * math.pi) - math.pi


@app.get("/")
def root():
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
        "note": "Integral and derivative gains are zero by default.",
    }


@app.post("/api/simulate")
def simulate(request: SimulationRequest):
    """Simulate a robot following a user-drawn path and return frames for the UI.

    This is a browser-friendly geometric simulation, not a Pygame window. The
    PID controller acts on normalized signed cross-track error; a lookahead
    heading term helps the robot anticipate bends in the drawn path.
    """
    path = request.path
    total_length = sum(_distance(path[i], path[i + 1]) for i in range(len(path) - 1))
    if total_length < 10:
        raise HTTPException(status_code=422, detail="Please draw a longer path before starting.")

    # Start at the beginning of the path, facing its first non-zero segment.
    start_segment = next(
        (i for i in range(len(path) - 1) if _distance(path[i], path[i + 1]) > 1),
        None,
    )
    if start_segment is None:
        raise HTTPException(status_code=422, detail="The path must contain a usable segment.")

    x, y = path[0].x, path[0].y
    first, second = path[start_segment], path[start_segment + 1]
    heading = math.atan2(second.y - first.y, second.x - first.x)
    integral = 0.0
    previous_error = 0.0
    dt = 1.0
    frames = []
    errors = []
    lost_steps = 0
    end_tolerance = max(12.0, request.lookahead * 0.65)

    for step in range(request.max_steps):
        nearest = _nearest_path_location(x, y, path)
        segment_index, qx, qy, t, distance = nearest
        a, b = path[segment_index], path[segment_index + 1]
        tangent_x, tangent_y = b.x - a.x, b.y - a.y
        tangent_length = max(math.hypot(tangent_x, tangent_y), 1e-9)
        tangent_x, tangent_y = tangent_x / tangent_length, tangent_y / tangent_length

        # Signed error is positive when the robot is to the right of the path
        # tangent; negate it so positive PID correction steers back toward path.
        cross = tangent_x * (y - qy) - tangent_y * (x - qx)
        error = -cross / 30.0  # normalize pixel error to keep gains interpretable
        integral = max(-20.0, min(20.0, integral + error * dt))
        derivative = (error - previous_error) / dt
        pid_output = (
            request.pid.kp * error
            + request.pid.ki * integral
            + request.pid.kd * derivative
        )
        target_x, target_y = _point_ahead(path, segment_index, t, request.lookahead)
        desired_heading = math.atan2(target_y - y, target_x - x)
        heading_error = _wrap_angle(desired_heading - heading)

        # Combine path-anticipation with PID steering; clamp to avoid unstable jumps.
        steering = max(-0.35, min(0.35, 0.7 * heading_error + 0.08 * pid_output))
        heading = _wrap_angle(heading + steering)
        x += math.cos(heading) * request.speed
        y += math.sin(heading) * request.speed
        previous_error = error
        errors.append(abs(error) * 30.0)

        endpoint = path[-1]
        end_distance = math.hypot(x - endpoint.x, y - endpoint.y)
        if distance > 90:
            lost_steps += 1

        # Limit payload size while retaining enough points for smooth animation.
        if step % 2 == 0 or step == request.max_steps - 1:
            frames.append({
                "x": round(x, 3),
                "y": round(y, 3),
                "heading": round(heading, 5),
                "error": round(error, 4),
                "cross_track_error": round(distance, 3),
                "steering": round(steering, 5),
                "step": step + 1,
            })

        if end_distance <= end_tolerance and step > 10:
            break

    return {
        "frames": frames,
        "metrics": {
            "steps": step + 1,
            "frames": len(frames),
            "mean_absolute_error_px": round(sum(errors) / max(len(errors), 1), 3),
            "max_error_px": round(max(errors, default=0.0), 3),
            "lost_track_steps": lost_steps,
            "reached_endpoint": math.hypot(x - path[-1].x, y - path[-1].y) <= end_tolerance,
        },
        "pid": request.pid.model_dump(),
    }
