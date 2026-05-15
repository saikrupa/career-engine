#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt
python -m playwright install chromium

if [ ! -f "config.yaml" ]; then
  echo "Missing config.yaml"
  exit 1
fi

MODE="${1:-scheduler}"
if [ "$MODE" = "once" ]; then
  python main.py --mode once --config config.yaml
elif [ "$MODE" = "agent" ]; then
  shift || true
  CMD="${*:-Apply to backend jobs matching my resume}"
  python main.py --mode agent --config config.yaml --command "$CMD"
else
  python main.py --mode scheduler --config config.yaml
fi
