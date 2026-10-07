#!/bin/sh
# Post-install for .deb / .rpm — seed config dir + example YAML.
# First launch still opens the setup wizard (local / Atlas / IaaS + workspace).

set -e
CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/AgentStudio"
mkdir -p "$CFG_DIR"
EXAMPLE_SRC=""
for c in \
  /usr/lib/agent-studio/resources/agent-studio.yaml.example \
  /usr/libexec/agent-studio/resources/agent-studio.yaml.example \
  /opt/Agent\ Studio/resources/agent-studio.yaml.example
do
  if [ -f "$c" ]; then EXAMPLE_SRC="$c"; break; fi
done
if [ -n "$EXAMPLE_SRC" ] && [ ! -f "$CFG_DIR/agent-studio.yaml.example" ]; then
  cp "$EXAMPLE_SRC" "$CFG_DIR/agent-studio.yaml.example" || true
fi

cat <<EOF
Agent Studio installed.

On first launch you will be asked for:
  - Workspace folder (default: ~/AgentStudio)
  - MongoDB deployment: Local / Atlas / IaaS
  - Database name + connection URI
  - Backend API port

Editable config (created after setup):
  $CFG_DIR/agent-studio.yaml

Start MongoDB before opening the app when using Local mode, e.g.:
  docker run -d --name mongo -p 27017:27017 mongo:7
EOF
