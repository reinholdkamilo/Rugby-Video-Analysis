#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000/backend}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

json_value() {
  local key="$1"
  python -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$key"
}

request_json() {
  curl --silent --show-error --fail "$@"
}

echo "1/8 Checking proxied backend health..."
request_json "$BASE_URL/health" | grep -q '"healthy"'

suffix="$(date +%s)-$RANDOM"

echo "2/8 Creating organisation..."
organisation_json="$(request_json -X POST "$BASE_URL/api/organisations" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test Organisation $suffix\"}")"
organisation_id="$(printf '%s' "$organisation_json" | json_value id)"

echo "3/8 Creating two teams..."
home_json="$(request_json -X POST "$BASE_URL/api/teams" \
  -H 'Content-Type: application/json' \
  -d "{\"organisation_id\":$organisation_id,\"name\":\"Home $suffix\",\"age_group\":\"Open\"}")"
away_json="$(request_json -X POST "$BASE_URL/api/teams" \
  -H 'Content-Type: application/json' \
  -d "{\"organisation_id\":$organisation_id,\"name\":\"Away $suffix\",\"age_group\":\"Open\"}")"
home_id="$(printf '%s' "$home_json" | json_value id)"
away_id="$(printf '%s' "$away_json" | json_value id)"

echo "4/8 Creating match..."
match_json="$(request_json -X POST "$BASE_URL/api/matches" \
  -H 'Content-Type: application/json' \
  -d "{\"organisation_id\":$organisation_id,\"home_team_id\":$home_id,\"away_team_id\":$away_id,\"match_date\":\"2026-07-12\",\"competition\":\"Smoke Test\",\"venue\":\"Codespaces\"}")"
match_id="$(printf '%s' "$match_json" | json_value id)"

echo "5/8 Generating a short test video with FFmpeg..."
ffmpeg -loglevel error -y \
  -f lavfi -i testsrc=size=640x360:rate=25 \
  -f lavfi -i sine=frequency=1000:sample_rate=44100 \
  -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$TMP_DIR/smoke-test.mp4"

echo "6/8 Uploading video and creating analysis job..."
video_json="$(request_json -X POST "$BASE_URL/api/matches/$match_id/videos" \
  -F "file=@$TMP_DIR/smoke-test.mp4;type=video/mp4")"
video_id="$(printf '%s' "$video_json" | json_value id)"
job_json="$(request_json -X POST "$BASE_URL/api/analysis-jobs" \
  -H 'Content-Type: application/json' \
  -d "{\"match_id\":$match_id,\"video_asset_id\":$video_id}")"
job_id="$(printf '%s' "$job_json" | json_value id)"

echo "7/8 Waiting for FFmpeg processing..."
job_status=""
for _ in $(seq 1 60); do
  job_json="$(request_json "$BASE_URL/api/analysis-jobs/$job_id")"
  job_status="$(printf '%s' "$job_json" | json_value status)"
  if [ "$job_status" = "completed" ]; then
    break
  fi
  if [ "$job_status" = "failed" ]; then
    echo "$job_json"
    exit 1
  fi
  sleep 1
done

if [ "$job_status" != "completed" ]; then
  echo "Processing did not complete in time. Last response: $job_json"
  exit 1
fi

request_json "$BASE_URL/api/videos/$video_id/processing-result" | grep -q '"width":640'

echo "8/8 Creating timeline event and clip..."
event_json="$(request_json -X POST "$BASE_URL/api/timeline-events" \
  -H 'Content-Type: application/json' \
  -d "{\"match_id\":$match_id,\"video_asset_id\":$video_id,\"event_type\":\"tackle\",\"team\":\"home\",\"start_seconds\":0.5,\"end_seconds\":2.5,\"player_name\":\"Smoke Tester\",\"outcome\":\"Complete\",\"notes\":\"Automated smoke test\",\"phase_number\":1,\"field_zone\":\"Midfield\",\"clip_requested\":true}")"
event_id="$(printf '%s' "$event_json" | json_value id)"
request_json "$BASE_URL/api/timeline-events/$event_id" | grep -q '"event_type":"tackle"'

clip_json="$(request_json -X POST "$BASE_URL/api/timeline-events/$event_id/clip")"
printf '%s' "$clip_json" | grep -q '"duration_seconds"'

echo
printf 'PASS: organisation=%s match=%s video=%s job=%s event=%s\n' \
  "$organisation_id" "$match_id" "$video_id" "$job_id" "$event_id"
