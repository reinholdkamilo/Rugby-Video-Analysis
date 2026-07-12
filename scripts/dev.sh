#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

LOG_DIR="$PROJECT_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"
STARTUP_LOG="$LOG_DIR/dev.log"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PID_FILE="$LOG_DIR/dev.pids"

: > "$STARTUP_LOG"
: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"
exec > >(tee -a "$STARTUP_LOG") 2>&1

echo "Starting Rugby Video Analysis at $(date -Iseconds)"

REQUIREMENTS_STAMP="$PROJECT_ROOT/.venv/.requirements.sha256"
CURRENT_REQUIREMENTS_HASH="$({ sha256sum backend/requirements.txt; [ -f backend/requirements-dev.txt ] && sha256sum backend/requirements-dev.txt || true; } | sha256sum | awk '{print $1}')"
INSTALLED_REQUIREMENTS_HASH=""
if [ -f "$REQUIREMENTS_STAMP" ]; then
  INSTALLED_REQUIREMENTS_HASH="$(cat "$REQUIREMENTS_STAMP")"
fi

# A previous interrupted installation can leave .venv present but incomplete.
# Also reinstall whenever the checked-in requirements change, including Stage 5
# computer-vision packages such as OpenCV and NumPy.
if [ ! -x .venv/bin/python ] \
  || [ "$CURRENT_REQUIREMENTS_HASH" != "$INSTALLED_REQUIREMENTS_HASH" ] \
  || ! .venv/bin/python -c "import uvicorn, fastapi, sqlalchemy, cv2, numpy" >/dev/null 2>&1; then
  echo "Python environment is missing, incomplete, or out of date; repairing dependencies."
  bash scripts/install.sh
  printf '%s\n' "$CURRENT_REQUIREMENTS_HASH" > "$REQUIREMENTS_STAMP"
fi

if [ ! -d frontend/node_modules ] || [ ! -x frontend/node_modules/.bin/next ]; then
  echo "Frontend dependencies are missing or incomplete; installing them."
  (cd frontend && npm install)
fi

PYTHON="$PROJECT_ROOT/.venv/bin/python"

for port in 8000 3000; do
  pids="$(lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping existing process on port ${port}: ${pids}"
    kill $pids 2>/dev/null || true
  fi
done
sleep 1

cleanup() {
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

(
  cd backend
  exec "$PYTHON" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

printf '%s\n' "$BACKEND_PID" > "$PID_FILE"
echo "Backend process started with PID ${BACKEND_PID}."
echo "Waiting for backend health check..."

backend_ready=false
for _ in $(seq 1 45); do
  if curl --silent --fail http://127.0.0.1:8000/health >/dev/null; then
    backend_ready=true
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$backend_ready" != true ]; then
  echo "Backend failed to start. Backend log:"
  cat "$BACKEND_LOG"
  exit 1
fi

echo "Backend is healthy."

(
  cd frontend
  BACKEND_INTERNAL_URL=http://127.0.0.1:8000 exec npm run dev
) > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
printf '%s\n' "$FRONTEND_PID" >> "$PID_FILE"

echo "Frontend process started with PID ${FRONTEND_PID}."
echo "Waiting for frontend and backend proxy..."

frontend_ready=false
for _ in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:3000/backend/health >/dev/null; then
    frontend_ready=true
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$frontend_ready" != true ]; then
  echo "Frontend failed to start or proxy the backend. Frontend log:"
  cat "$FRONTEND_LOG"
  exit 1
fi

echo
echo "Rugby Video Analysis is ready:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  Health:   http://localhost:3000/backend/health"
echo "  Logs:     $LOG_DIR"
echo
echo "Keep this terminal open. Press Ctrl+C to stop both services."

wait "$FRONTEND_PID"
