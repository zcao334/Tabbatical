#!/usr/bin/env bash
#
# Regenerate the extension PNG icons from src/icons/icon.svg.
#
# Produces two sets from the one source:
#
#   icon{16,48,128}.png   full bleed, used by action.default_icon (the toolbar)
#   store{16,48,128}.png  96x96 of artwork inside 16px of transparent padding,
#                         used by the manifest "icons" entry
#
# The split exists because the two have opposite requirements. The Chrome Web
# Store asks for the padding so listings sit at a consistent visual weight next
# to each other, while the toolbar button is already inset by Chrome and padding
# it again leaves the mark too small to read at 16px.
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

# 96/128. Keep in step with the translate below: the offset is (128-128*SCALE)/2.
SCALE="0.75"
OFFSET="16"

command -v qlmanage >/dev/null 2>&1 || { echo "error: qlmanage not found, this needs macOS." >&2; exit 1; }
[ -f "$SRC" ] || { echo "error: $SRC not found." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The padded variant, built by wrapping the artwork rather than duplicating it,
# so the two sets can never drift apart.
PADDED="$TMP/store.svg"
sed -e "s|^<svg \(.*\)>$|<svg \1><g transform=\"translate($OFFSET,$OFFSET) scale($SCALE)\">|" \
    -e "s|^</svg>$|</g></svg>|" "$SRC" > "$PADDED"
grep -q '<g transform=' "$PADDED" || { echo "error: could not wrap $SRC; has its <svg> tag changed shape?" >&2; exit 1; }

render() {
  local src="$1" size="$2" dest="$3"
  qlmanage -t -s "$size" -o "$TMP" "$src" >/dev/null 2>&1

  local rendered="$TMP/$(basename "$src").png"
  [ -f "$rendered" ] || { echo "error: qlmanage produced nothing at ${size}px." >&2; exit 1; }

  # qlmanage fits the render into a size x size box. A non-square result means
  # the viewBox is not square and the icons would be silently letterboxed.
  read -r width height <<<"$(sips -g pixelWidth -g pixelHeight "$rendered" \
    | awk '/pixelWidth|pixelHeight/ { printf "%s ", $2 }')"
  if [ "$width" != "$size" ] || [ "$height" != "$size" ]; then
    echo "error: expected ${size}x${size}, got ${width}x${height}." >&2
    exit 1
  fi

  mv "$rendered" "$dest"
  echo "wrote $dest"
}

for size in "${SIZES[@]}"; do
  render "$SRC" "$size" "$OUT/icon${size}.png"
  render "$PADDED" "$size" "$OUT/store${size}.png"
done
