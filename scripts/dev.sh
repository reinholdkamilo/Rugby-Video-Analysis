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

set -a
for env_file in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.local" "$PROJECT_ROOT/backend/.env" "$PROJECT_ROOT/backend/.env.local"; do
  if [ -f "$env_file" ]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
done
set +a

REQUIREMENTS_STAMP="$PROJECT_ROOT/.venv/.requirements.sha256"
CURRENT_REQUIREMENTS_HASH="$({ sha256sum backend/requirements.txt; [ -f backend/requirements-dev.txt ] && sha256sum backend/requirements-dev.txt || true; } | sha256sum | awk '{print $1}')"
INSTALLED_REQUIREMENTS_HASH=""
if [ -f "$REQUIREMENTS_STAMP" ]; then
  INSTALLED_REQUIREMENTS_HASH="$(cat "$REQUIREMENTS_STAMP")"
fi

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
sleep 2

cleanup() {
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

# Do not use uvicorn --reload here. In Codespaces the reloader can briefly pass
# a health check and then exit, leaving Next.js proxying to a dead port.
(
  cd backend
  exec "$PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
) > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

printf '%s\n' "$BACKEND_PID" > "$PID_FILE"
echo "Backend process started with PID ${BACKEND_PID}."
echo "Waiting for stable backend health checks..."

backend_ready=false
consecutive_health_checks=0
for _ in $(seq 1 60); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    break
  fi

  if curl --silent --fail http://127.0.0.1:8000/health >/dev/null; then
    consecutive_health_checks=$((consecutive_health_checks + 1))
    if [ "$consecutive_health_checks" -ge 3 ]; then
      backend_ready=true
      break
    fi
  else
    consecutive_health_checks=0
  fi
  sleep 1
done

if [ "$backend_ready" != true ]; then
  echo "Backend failed to remain healthy. Backend log:"
  cat "$BACKEND_LOG"
  exit 1
fi

echo "Backend is stable and healthy."

(
  cd frontend
  BACKEND_INTERNAL_URL=http://127.0.0.1:8000 exec npm run dev
) > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
printf '%s\n' "$FRONTEND_PID" >> "$PID_FILE"

echo "Frontend process started with PID ${FRONTEND_PID}."
echo "Waiting for frontend and backend proxy..."

frontend_ready=false
for _ in $(seq 1 90); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited while the frontend was starting. Backend log:"
    cat "$BACKEND_LOG"
    exit 1
  fi

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
  echo "Frontend failed to start or proxy the backend."
  echo "Backend log:"
  cat "$BACKEND_LOG"
  echo
  echo "Frontend log:"
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

# Exit if either service stops, rather than silently leaving half the stack alive.
while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend stopped unexpectedly. Backend log:"
    cat "$BACKEND_LOG"
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend stopped unexpectedly. Frontend log:"
    cat "$FRONTEND_LOG"
    exit 1
  fi
  sleep 2
done
