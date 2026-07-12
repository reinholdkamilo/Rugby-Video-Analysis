#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.dev-logs"
PID_FILE="$LOG_DIR/dev.pid"

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Rugby Video Analysis is already running (PID $existing_pid)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$PROJECT_ROOT"
nohup bash scripts/dev.sh >"$LOG_DIR/dev.log" 2>&1 &
echo $! >"$PID_FILE"

echo "Starting Rugby Video Analysis automatically..."
for _ in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:3000/backend/health >/dev/null 2>&1; then
    echo "Rugby Video Analysis is ready on port 3000."
    exit 0
  fi
  sleep 1
done

echo "Automatic startup did not become healthy within 60 seconds."
echo "Recent logs:"
tail -n 80 "$LOG_DIR/dev.log" || true
exit 1
