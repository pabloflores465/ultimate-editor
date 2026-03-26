#!/bin/bash
# Patch @xterm/xterm to allow lineHeight < 1 (minimum 0.5)
# xterm.js validates lineHeight >= 1, but browsers measure fonts taller
# than native terminals, so we need values like 0.85 for compact spacing.

XTERM_DIR="node_modules/@xterm/xterm/lib"

for f in "$XTERM_DIR/xterm.mjs" "$XTERM_DIR/xterm.js"; do
  if [ -f "$f" ]; then
    sed -i '' \
      's/case"lineHeight":case"tabStopWidth":if(i<1)throw new Error(`${e} cannot be less than 1, value: ${i}`)/case"lineHeight":if(i<0.5){throw new Error(`${e} cannot be less than 0.5, value: ${i}`);}break;case"tabStopWidth":if(i<1)throw new Error(`${e} cannot be less than 1, value: ${i}`)/' \
      "$f"
  fi
done

echo "✓ xterm.js patched: lineHeight minimum lowered to 0.5"
