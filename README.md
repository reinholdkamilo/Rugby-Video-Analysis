# Rugby Video Analysis

A professional rugby video-analysis platform for uploading match footage, tagging rugby events, generating clips, calculating performance metrics, and producing coaching reports.

## Foundation stack

- Next.js and TypeScript frontend
- FastAPI and Python backend
- SQLAlchemy with SQLite locally and PostgreSQL in production
- FFmpeg and ffprobe video preparation and clip export
- GitHub Codespaces development environment
- GitHub Actions continuous integration
- Render backend, PostgreSQL, and persistent video storage configuration
- Vercel frontend deployment configuration

## Current platform capabilities

- Create organisations, teams, and matches
- Upload MP4, MOV, AVI, and MKV match videos
- Process queued footage and extract video metadata
- Generate thumbnails and display live processing status
- Open a dedicated timeline analyst workspace at `/timeline`
- Tag kickoff, scrum, lineout, carry, tackle, ruck, maul, pass, kick, turnover, penalty, try, conversion, card, stoppage, and custom events
- Record event team, start/end time, player, outcome, phase number, field zone, and analyst notes
- Filter tagged moments by rugby event type
- Automatically export event clips with FFmpeg
- Regenerate clips after timestamp changes
- Serve generated clips from persistent storage

Interactive API documentation is available at `/docs` while the backend is running.

## Current workflow

1. Create an organisation and at least two teams.
2. Create a match and upload footage.
3. The worker probes the footage and generates a thumbnail.
4. Open `/timeline` and select the match and video.
5. Enter the event start/end timestamps and rugby details.
6. Save the event and optionally export its clip automatically.
7. Review or open clips from the chronological timeline.

## Timeline endpoints

```text
POST  /api/timeline-events
GET   /api/timeline-events
GET   /api/timeline-events/{event_id}
PATCH /api/timeline-events/{event_id}
POST  /api/timeline-events/{event_id}/clip
GET   /media/clips/{clip_name}
```

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

## Codespaces development

The repository installs Python, Node, and FFmpeg dependencies automatically when a Codespace is created.

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

## Environment

```text
UPLOAD_DIR=uploads
THUMBNAIL_DIR=thumbnails
CLIP_DIR=clips
ENABLE_EMBEDDED_WORKER=true
WORKER_POLL_INTERVAL_SECONDS=3
```

## Deployment

`render.yaml` provisions the backend, PostgreSQL, FFmpeg-enabled processing, and a persistent disk shared by uploaded footage, thumbnails, and exported clips. The frontend is prepared for Vercel using `frontend` as the project root.
