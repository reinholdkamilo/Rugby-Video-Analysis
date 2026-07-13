# Production infrastructure

This document defines the first hosted testing environment for Rugby Video Analysis.

## Architecture

- **GitHub**: source control and CI
- **Render Web Service**: FastAPI API, upload assembly, FFmpeg/OpenCV processing
- **Render PostgreSQL**: application data
- **Render persistent disk**: uploaded videos, upload sessions, thumbnails, clips, and vision frames
- **Vercel**: Next.js frontend

The current hosted foundation intentionally keeps the worker embedded in the Render web service so the API and worker can access the same persistent disk. This is suitable for staging and early production testing. A later object-storage milestone will move videos to S3-compatible storage and split the worker into its own service.

## Render deployment

1. Create a new Render Blueprint from this repository.
2. Select `render.yaml` from the repository root.
3. Choose the `feature/production-infrastructure` branch for initial staging validation. After the pull request is merged, change the tracked branch to `main` or `develop`.
4. Provide the required `FRONTEND_URL` and `ALLOWED_ORIGINS` values after Vercel creates the frontend URL.
5. Use a paid service and disk tier for uploads that must not stop when the service is idle.
6. Confirm these endpoints:
   - `/health`
   - `/api/system`

## Vercel deployment

1. Import the GitHub repository into Vercel.
2. Set the project root directory to `frontend`.
3. Set `BACKEND_INTERNAL_URL` to the Render API base URL, without a trailing slash.
4. Deploy the frontend.
5. Copy the Vercel URL into Render as both `FRONTEND_URL` and `ALLOWED_ORIGINS`.
6. Redeploy the Render service after changing those variables.

## Required verification

- Render `/health` returns HTTP 200.
- Vercel `/backend/health` returns HTTP 200.
- Vercel `/backend/api/system` reports a healthy database and FFmpeg installation.
- An organisation, two teams, and a match can be created.
- A short test video uploads successfully.
- The analysis job reaches `completed`.
- The generated thumbnail is accessible after a Render restart.

## Current scaling boundary

The persistent disk is attached to one Render service. This is reliable for the first hosted environment but prevents horizontal scaling and a separate worker from sharing files. Before multiple concurrent full-match analyses are enabled, implement:

- S3-compatible object storage
- direct multipart browser uploads
- a separate background worker
- durable queue and retry handling
- object-storage-backed clips, thumbnails, and reports
