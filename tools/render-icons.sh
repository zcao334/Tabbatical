#!/usr/bin/env bash
#
# Regenerate the extension PNG icons from src/icons/icon.svg.
#
# Deliberately NOT part of `npm run build`: it shells out to qlmanage, which is
# macOS-only, and wiring it into the build would break it everywhere else. The
# icons change roughly never, so generating them by hand and committing the
# result costs nothing and keeps the build portable.
#
# Usage: tools/render-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="src/icons/icon.svg"
OUT="src/icons"
SIZES=(16 48 128)

if ! command -v qlmanage >/dev/null 2>&1; then
  echo "error: qlmanage not found — this script needs macOS." >&2
  exit 1
fi

[ -f "$SRC" ] || { echo "error: $SRC not found." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for size in "${SIZES[@]}"; do
  qlmanage -t -s "$size" -o "$TMP" "$SRC" >/dev/null 2>&1

  rendered="$TMP/$(basename "$SRC").png"
  [ -f "$rendered" ] || { echo "error: qlmanage produced nothing at ${size}px." >&2; exit 1; }

  # qlmanage fits the render into a size×size box. A non-square result means
  # the SVG's viewBox is not square and the icons would be silently letterboxed.
  read -r width height <<<"$(sips -g pixelWidth -g pixelHeight "$rendered" \
    | awk '/pixelWidth|pixelHeight/ { printf "%s ", $2 }')"
  if [ "$width" != "$size" ] || [ "$height" != "$size" ]; then
    echo "error: expected ${size}x${size}, got ${width}x${height}." >&2
    exit 1
  fi

  mv "$rendered" "$OUT/icon${size}.png"
  echo "wrote $OUT/icon${size}.png"
done
