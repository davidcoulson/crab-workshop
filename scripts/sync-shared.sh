#!/bin/sh
# Copies /shared into every mod's hooks/shared/ (mods import only their own files).
set -e
cd "$(dirname "$0")/.."
for p in plugins/*/; do
  mkdir -p "$p/hooks/shared"
  cp shared/*.ts "$p/hooks/shared/"
done
