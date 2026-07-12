# Rugby Video Analysis

A professional rugby video-analysis platform for uploading match footage, tagging rugby events, generating clips, calculating performance metrics, and producing coaching reports.

## Foundation stack

- Next.js and TypeScript frontend
- FastAPI and Python backend
- GitHub Codespaces development environment
- GitHub Actions continuous integration
- Render backend deployment configuration
- Vercel frontend deployment configuration

## Codespaces development

The repository is configured to install both backend and frontend dependencies automatically when a Codespace is created.

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

## Deployment

The backend is prepared for deployment to Render using `render.yaml`. The frontend is prepared for Vercel using the `frontend` directory as the project root.
