# LineFollower

Interactive **PID Lab** — tune controllers on a process model, then run the same gains on a line-following robot in the browser.

The UI is a single-page site (HTML, CSS, JavaScript) served by a **FastAPI** backend. All simulation math runs on the server; the frontend draws tracks, charts, and animation frames from API responses.

## Demo

[Live app](https://line-follower.onrender.com)
hosted on Render

## What you can do

- **PID tuning**: Step-response experiment (P, PD, PID, PID Ratio) with setpoint, metrics, and live plots.
- **Sensor-based line follow**: Draw or load a track; simulate weighted IR-style sensors with 2, 5, or 7 sensors.
- **Path-aware follow**: Same track, but the vehicle uses geometry (cross-track error and lookahead) to recover when it drifts.
- **Theory & implementation**: Short sections on P/I/D and how the stack is wired.

## How it works

| Layer | Role |
|--------|------|
| **Frontend** (`frontend/`) | Layout, controls, canvas rendering, tab switching, calling the API |
| **Backend** (`backend/main.py`) | REST endpoints, validation (Pydantic), PID process model, sensor and path simulations |
| **Deploy** | One service can host both API and static files (e.g. Render + Uvicorn) |

### API endpoints

- `POST /api/pid-process` — First-order process + dead time; step response and metrics.
- `POST /api/sensor-simulate` — Normalized path, sensor model, controller; returns frames for playback.
- `POST /api/simulate` — Path-aware following on pixel coordinates; returns frames.
- `GET /docs` — OpenAPI (Swagger UI) when the server is running.

## Tech stack

- **Backend:** Python 3, FastAPI, Uvicorn, Pydantic  
- **Frontend:** HTML, CSS, JavaScript (Canvas 2D)  
- **Local run:** `uvicorn backend.main:app --reload` serves the API and `frontend/` static assets

Dependencies are listed in `requirements.txt` (includes FastAPI stack; some packages support optional offline/reference scripts outside this repo).

## Project structure

```text
LineFollower/
├── backend/
│   └── main.py          # FastAPI app, simulation logic, static frontend mount
├── frontend/
│   ├── index.html       # Page structure and copy
│   ├── script.js        # UI logic, charts, API client
│   └── styles.css       # Layout, typography, responsive tokens
├── requirements.txt     # Python dependencies
├── .python-version      # Suggested Python version for local dev
├── .gitignore
└── README.md
```

## Setup

Create a virtual environment:

```bash
python -m venv .venv
```

Activate it and install dependencies:

```bash
pip install -r requirements.txt
```

Run the backend (serves the site at the root URL):

```bash
uvicorn backend.main:app --reload
```

Open the app at [http://127.0.0.1:8000](http://127.0.0.1:8000).  
Interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

## References

The original line-following robot algorithms and related concepts were sourced from the following resources:

- [Algorytmy PID w robotyce amatorskiej — LineFollower](https://forbot.pl/forum/topic/3723-algorytmy-pid-w-robotyce-amatorskiej-linefollower-cz1-czlon-p/)
- [Kurs budowy robotów Line Follower](https://forbot.pl/blog/kurs-budowy-robotow-line-follower-czyli-bolid-f1-id19363)

This project builds on and adapts these references for an interactive web-based demonstration. Credit belongs to the original authors and publishers. Please refer to the original sources for their applicable licensing and attribution terms.

---

## Author

**Shiv Modi** — B.Tech. + M.Tech., IIT Bombay  
[GitHub](https://github.com/shivmodi21) · [Portfolio](https://shivmodi21.github.io/) · [LinkedIn](https://www.linkedin.com/in/shivmodi210/)
