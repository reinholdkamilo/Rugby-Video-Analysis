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

stop_pid_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

# Stop processes recorded by a previous run before checking listeners. This also
# catches orphaned Next.js child processes created by an interrupted Codespace.
if [ -f "$PID_FILE" ]; then
  while read -r old_pid; do
    stop_pid_tree "$old_pid"
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# Stop known project servers that may have survived outside the PID file.
pkill -TERM -f "uvicorn app.main:app.*--port 8000" 2>/dev/null || true
pkill -TERM -f "next dev.*--port 3000" 2>/dev/null || true
sleep 2

for port in 8000 3000; do
  for attempt in $(seq 1 10); do
    pids="$(lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
    if [ -z "$pids" ]; then
      break
    fi
    echo "Stopping existing process on port ${port}: ${pids}"
    if [ "$attempt" -lt 5 ]; then
      kill -TERM $pids 2>/dev/null || true
    else
      kill -KILL $pids 2>/dev/null || true
    fi
    sleep 1
  done

  if lsof -t -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Unable to free port ${port}. Refusing to start a duplicate server."
    exit 1
  fi
done

cleanup() {
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      stop_pid_tree "$pid"
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

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
echo "Waiting for frontend, homepage and backend proxy..."

frontend_ready=false
for _ in $(seq 1 90); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited while the frontend was starting. Backend log:"
    cat "$BACKEND_LOG"
    exit 1
  fi

  if curl --silent --fail http://127.0.0.1:3000/ >/dev/null \
    && curl --silent --fail http://127.0.0.1:3000/backend/health >/dev/null; then
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

PUBLIC_FRONTEND_URL=""
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  PUBLIC_FRONTEND_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

echo
echo "Rugby Video Analysis is ready:"
echo "  Local frontend: http://localhost:3000"
if [ -n "$PUBLIC_FRONTEND_URL" ]; then
  echo "  OPEN THIS URL:  $PUBLIC_FRONTEND_URL"
fi
echo "  Backend:        http://localhost:8000"
echo "  Health:         http://localhost:3000/backend/health"
echo "  Logs:           $LOG_DIR"
echo
echo "Keep this terminal open. Press Ctrl+C to stop both services."

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
