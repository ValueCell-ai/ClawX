#!/usr/bin/env bash
set -euo pipefail

CDP_PORT="${CDP_PORT:-9222}"
OUT_DIR="${OUT_DIR:-playground/agent-browser}"
mkdir -p "$OUT_DIR"

agent-browser connect "$CDP_PORT"
agent-browser tab > "$OUT_DIR/00-tabs.txt"
agent-browser snapshot -i > "$OUT_DIR/01-initial.snapshot.txt"
agent-browser screenshot "$OUT_DIR/01-initial.png"

agent-browser find text "技能" click || agent-browser find text "Skills" click || true
agent-browser wait 1000
agent-browser snapshot -i > "$OUT_DIR/02-skills.snapshot.txt"
agent-browser screenshot "$OUT_DIR/02-skills.png"
