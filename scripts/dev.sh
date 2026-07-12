#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -d .venv ]; then
  bash scripts/install.sh
fi

source .venv/bin/activate

for port in 8000 3000; do
  pids="$(lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
  fi
done

cleanup() {
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd backend
  exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "Waiting for backend health check..."
for _ in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:8000/health >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl --silent --fail http://127.0.0.1:8000/health >/dev/null; then
  echo "Backend failed to start on port 8000."
  exit 1
fi

(
  cd frontend
  BACKEND_INTERNAL_URL=http://127.0.0.1:8000 exec npm run dev
) &
FRONTEND_PID=$!

echo
echo "Rugby Video Analysis is running:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  Health:   http://localhost:3000/backend/health"
echo
echo "Keep this terminal open. Press Ctrl+C to stop both services."

wait "$FRONTEND_PID"
