#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$project_dir/backend" && DJANGO_DEBUG=true uv run python manage.py runserver 127.0.0.1:8000) &
api_pid=$!
(cd "$project_dir/frontend" && npm run dev -- --port 5173) &
web_pid=$!
trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' EXIT INT TERM
wait
