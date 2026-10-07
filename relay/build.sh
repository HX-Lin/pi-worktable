#!/usr/bin/env bash
# Cross-compile the relay into a single static binary for the server.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
CGO_ENABLED=0 GOOS=linux GOARCH="${GOARCH:-amd64}" \
  go build -trimpath -ldflags "-s -w" -o dist/pi-relay .
echo "built relay/dist/pi-relay ($(du -h dist/pi-relay | cut -f1))"
