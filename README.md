# LineFollower
###### PID Controller

An interactive web project exploring PID control and line-following robot simulations. The project uses Python for the backend and HTML, CSS, and JavaScript for the frontend.

## Features

- PID controller visualization and tuning
- Line-following robot simulation
- Interactive charts and performance metrics

## Tech Stack

- **Backend:** Python, FastAPI
- **Frontend:** HTML, CSS, JavaScript
- **Simulation:** Pygame, NumPy, SciPy, Matplotlib
- **Deployment:** Render

## Project Structure

```text
LINEFOLLOWER/
├── backend/
│   └── main.py
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── styles.css
├── imgs/
├── src/
│   ├── line_follower_color.py
│   ├── line_follower_dist.py
│   ├── lineFollower.py
│   ├── myLineFollower.py
│   └── pid_tuning.py
├── .gitignore
├── requirements.txt
└── README.md
```

## Setup

```bash
python -m venv .venv
```

Activate the virtual environment and install dependencies:

```bash
pip install -r requirements.txt
```

Run the backend locally:

```bash
uvicorn backend.main:app --reload
```

Open the API documentation at `http://127.0.0.1:8000/docs`.

## Credits and References

The original line-following robot algorithms and related concepts were sourced from the following resources:

- [Algorytmy PID w robotyce amatorskiej — LineFollower](https://forbot.pl/forum/topic/3723-algorytmy-pid-w-robotyce-amatorskiej-linefollower-cz1-czlon-p/)
- [Kurs budowy robotów Line Follower](https://forbot.pl/blog/kurs-budowy-robotow-line-follower-czyli-bolid-f1-id19363)

This project builds on and adapts these references for an interactive web-based demonstration. Credit belongs to the original authors and publishers. Please refer to the original sources for their applicable licensing and attribution terms.

---

## Author

**Shiv Modi** — B.Tech. + M.Tech., IIT Bombay  
[GitHub](https://github.com/shivmodi21) · [Portfolio](https://shivmodi21.github.io/) · [LinkedIn](https://www.linkedin.com/in/shivmodi210/)