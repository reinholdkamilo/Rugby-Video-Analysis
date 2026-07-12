# Rugby Video Analysis

A professional rugby video-analysis platform for uploading match footage, tagging rugby events, generating clips, calculating performance metrics, and producing coaching reports.

## Foundation stack

- Next.js and TypeScript frontend
- FastAPI and Python backend
- SQLAlchemy with SQLite locally and PostgreSQL in production
- FFmpeg and ffprobe video preparation
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
- Process queued jobs with an embedded background worker
- Read duration, resolution, frame rate, video codec, and audio codec with ffprobe
- Generate a representative match thumbnail with FFmpeg
- Display live queued, processing, completed, and failed states
- Poll active jobs and update progress without a page reload
- Show completed video metadata and thumbnails in the dashboard
- Preserve readable failure messages when processing cannot complete

Interactive API documentation is available at `/docs` while the backend is running.

## Current workflow

1. Create an organisation.
2. Add at least two teams.
3. Create a match.
4. Upload match footage.
5. The platform creates an analysis job.
6. The embedded worker probes the footage and generates a thumbnail.
7. The dashboard updates automatically and displays the completed video details.

## Processing endpoints

```text
GET /api/analysis-jobs
GET /api/analysis-jobs/{job_id}
GET /api/videos/{video_asset_id}/processing-result
GET /media/thumbnails/{thumbnail_name}
```

The standalone worker can also be run with:

```bash
cd backend
python -m app.worker
```

Only one worker mode should process a given database at a time. The default local and Render configuration uses the embedded worker inside the FastAPI service so uploaded files and thumbnails share the same persistent storage.

## Codespaces development

The repository installs backend and frontend dependencies automatically when a Codespace is created. FFmpeg must be available in the development environment. The Render Docker image installs it automatically.

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

Important processing settings:

```text
UPLOAD_DIR=uploads
THUMBNAIL_DIR=thumbnails
ENABLE_EMBEDDED_WORKER=true
WORKER_POLL_INTERVAL_SECONDS=3
```

## Deployment

`render.yaml` provisions the backend web service, PostgreSQL database, FFmpeg-enabled Docker image, embedded worker, and a persistent disk shared by uploaded footage and generated thumbnails. The frontend is prepared for Vercel using `frontend` as the project root.
