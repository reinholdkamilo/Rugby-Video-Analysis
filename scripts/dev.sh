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
LOCK_FILE="$LOG_DIR/dev.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another Rugby Video Analysis launcher is already running."
  echo "Stop the older terminal with Ctrl+C, then run this command again."
  exit 1
fi

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
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  sleep 1
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

clear_port() {
  local port="$1"
  local label="$2"

  if fuser "${port}/tcp" >/dev/null 2>&1; then
    echo "Stopping existing ${label} listener on port ${port}."
    fuser -k -TERM "${port}/tcp" >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 10); do
    if ! fuser "${port}/tcp" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Force-stopping remaining listener on port ${port}."
  fuser -k -KILL "${port}/tcp" >/dev/null 2>&1 || true

  for _ in $(seq 1 5); do
    if ! fuser "${port}/tcp" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Unable to free port ${port}."
  fuser -v "${port}/tcp" 2>/dev/null || true
  exit 1
}

if [ -f "$PID_FILE" ]; then
  while read -r old_pid; do
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill -TERM "$old_pid" 2>/dev/null || true
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
  sleep 1
fi

clear_port 8000 "backend"
clear_port 3000 "frontend"

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
for attempt in $(seq 1 60); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    break
  fi
  if curl --max-time 2 --silent --fail http://127.0.0.1:8000/health >/dev/null; then
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
  BACKEND_INTERNAL_URL=http://127.0.0.1:8000 \
    exec ./node_modules/.bin/next dev --hostname 0.0.0.0 --port 3000
) > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
printf '%s\n' "$FRONTEND_PID" >> "$PID_FILE"

echo "Frontend process started with PID ${FRONTEND_PID}."
echo "Waiting for frontend, homepage and backend proxy..."

frontend_ready=false
for attempt in $(seq 1 90); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited while the frontend was starting. Backend log:"
    cat "$BACKEND_LOG"
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    break
  fi

  # Next.js may hand the listening socket to a child process, so checking for
  # exact PID ownership is unreliable. Ports were force-cleared before launch;
  # a healthy homepage plus backend proxy is the reliable readiness signal.
  if curl --max-time 3 --silent --fail http://127.0.0.1:3000/ >/dev/null \
    && curl --max-time 3 --silent --fail http://127.0.0.1:3000/backend/health >/dev/null; then
    frontend_ready=true
    break
  fi

  if [ $((attempt % 10)) -eq 0 ]; then
    echo "Still waiting for frontend... ${attempt}s elapsed"
    tail -n 12 "$FRONTEND_LOG" 2>/dev/null || true
  fi
  sleep 1
done

if [ "$frontend_ready" != true ]; then
  echo "Frontend failed to become ready."
  echo "Current port owner:"
  fuser -v 3000/tcp 2>/dev/null || true
  echo
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
