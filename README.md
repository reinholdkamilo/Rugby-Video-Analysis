# Rugby Video Analysis

A professional rugby video-analysis platform for uploading match footage, tagging rugby events, generating clips, calculating performance metrics, and producing coaching reports.

## Foundation stack

- Next.js and TypeScript frontend
- FastAPI and Python backend
- SQLAlchemy with SQLite locally and PostgreSQL in production
- GitHub Codespaces development environment
- GitHub Actions continuous integration
- Render backend, PostgreSQL, and persistent video storage configuration
- Vercel frontend deployment configuration

## Current platform capabilities

- Create and select organisations from the frontend workspace
- Add teams and age groups to an organisation
- Create matches with teams, date, competition, and venue
- Upload MP4, MOV, AVI, and MKV match videos
- Automatically create an analysis job after a successful upload
- Display queued, processing, completed, and failed analysis states
- Poll active analysis jobs and update progress without a page reload
- Store video metadata and persistent storage paths
- Use typed frontend API requests with readable backend error messages

Interactive API documentation is available at `/docs` while the backend is running.

## Current workflow

1. Create an organisation.
2. Add at least two teams.
3. Create a match.
4. Upload match footage.
5. The platform creates an analysis job and displays its status.

The current worker layer does not process the video yet, so new jobs remain queued until the next processing milestone is added.

## Codespaces development

The repository installs backend and frontend dependencies automatically when a Codespace is created.

Start the backend:

```bash
source .venv/bin/activate
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Backend health check:

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"healthy","service":"backend"}
```

## Environment

Copy `.env.example` values into your local environment as required. The backend defaults to SQLite and switches to PostgreSQL whenever `DATABASE_URL` is supplied.

## Deployment

`render.yaml` provisions the backend web service, PostgreSQL database, and a persistent disk for uploaded footage. The frontend is prepared for Vercel using `frontend` as the project root.
