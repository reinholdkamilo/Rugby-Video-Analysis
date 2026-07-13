# Phase 1 — Complete

Phase 1 is the zero-cost, cloud-hosted validation release of the Rugby Video Analysis platform.

## Hosted services

- Frontend: `https://rugby-video-analysis.vercel.app`
- Backend: `https://rugby-video-analysis-api-free.onrender.com`
- Database: Neon PostgreSQL in Sydney
- Deployments: automatic from `main`

## Completed product capabilities

- Organisation and team creation
- Seasons, competitions and player rosters
- Match creation and match context
- Resumable short-clip upload with progress reporting
- Background video probing, thumbnails and processing status
- Manual timeline event creation and clip generation
- Professional coding workspace with keyboard controls and quick rugby tags
- Automatic suggestions, vision, understanding and rugby intelligence screens
- System diagnostics, database checks, FFmpeg checks, OpenCV checks and writable-media checks
- Global navigation across all Phase 1 workspaces

## Release acceptance criteria

Phase 1 is accepted when all of the following are true:

- Continuous Integration passes backend tests, frontend lint/build and the local smoke test.
- Vercel production deployment reports Ready.
- Render production deployment reports Live.
- `/health` responds successfully.
- `/api/system/ready` reports `healthy` and returns HTTP 200.
- The Vercel `/backend` proxy reaches Render successfully.
- Workspace, programme, coding, timeline, suggestions, understanding, intelligence and system routes load.
- A user can create an organisation, teams and a match.
- A short video under 100 MB can upload and process.
- A coded event can be created and remains after refresh.

## Free-tier operating constraints

- Render can sleep while idle, so the first request can take around one minute.
- Render local media storage is temporary and can be cleared by sleep, restart or deployment.
- Phase 1 is for short clips and workflow validation, not reliable full-match retention.
- The hosted smoke workflow runs weekly and can also be triggered manually from GitHub Actions.

## Phase 2

Phase 2 introduces persistent Cloudflare R2-compatible object storage so footage, thumbnails, frames and clips survive restarts while development remains near zero cost.

## Phase 3

Phase 3 returns to the original paid production architecture: always-on compute, paid PostgreSQL, persistent object storage, dedicated workers, full-match processing and the comprehensive professional rugby analysis product.
