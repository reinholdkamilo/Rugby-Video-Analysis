#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

install_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    return
  fi

  local yarn_source="/etc/apt/sources.list.d/yarn.list"
  local yarn_backup="/tmp/rugby-video-analysis-yarn.list.disabled"
  local restore_yarn=false

  # Some Codespaces images include an expired Yarn apt key. Yarn is not needed
  # by this project, so temporarily disable that source while installing FFmpeg.
  if [ -f "$yarn_source" ]; then
    sudo mv "$yarn_source" "$yarn_backup"
    restore_yarn=true
  fi

  cleanup_yarn_source() {
    if [ "$restore_yarn" = true ] && [ -f "$yarn_backup" ]; then
      sudo mv "$yarn_backup" "$yarn_source"
    fi
  }
  trap cleanup_yarn_source RETURN

  sudo apt-get update
  sudo apt-get install -y --no-install-recommends ffmpeg
}

install_ffmpeg

if [ ! -d .venv ]; then
  python -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements-dev.txt

cd frontend
npm install

echo "Rugby Video Analysis dependencies installed successfully."
