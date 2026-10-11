#!/bin/sh
# Type-checks, validates and tests one mod (or all): scripts/check.sh [<mod>...]
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
sh scripts/sync-shared.sh
CLAUDE=${CLAUDE_BIN:-$(ls -d "$HOME/Library/Application Support/Claude/claude-code/"*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1)}
[ -x "$CLAUDE" ] || CLAUDE=claude
TYPES=${CLAUDE_TYPES:-$(ls -t /private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -1)}
TSC=${TSC:-$(ls -t "$HOME"/.npm/_npx/*/node_modules/typescript/bin/tsc 2>/dev/null | head -1)}
MODS=${*:-$(ls plugins)}
status=0
for m in $MODS; do
  P="$ROOT/plugins/$m"
  echo "== $m"
  if [ -n "$TSC" ] && [ -n "$TYPES" ]; then
    mkdir -p "$ROOT/.typecheck"
    cat > "$ROOT/.typecheck/$m.json" <<JSON
{ "compilerOptions": { "target": "es2023", "lib": ["es2023"], "module": "esnext", "moduleResolution": "bundler",
  "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true, "skipLibCheck": true,
  "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment", "types": [] },
  "include": ["$TYPES", "$P/hooks", "$P/types", "$P/tests"] }
JSON
    node "$TSC" -p "$ROOT/.typecheck/$m.json" || status=1
  else
    echo "(no tsc or types file: skipped type-check)"
  fi
  "$CLAUDE" plugin validate "$P" || status=1
  if ls "$P"/tests/*.test.ts* >/dev/null 2>&1; then "$CLAUDE" plugin test "$P" || status=1; fi
done
exit $status
