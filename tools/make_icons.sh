#!/bin/sh
# Render the PNG app icons from icons/icon.svg (macOS: uses Quick Look and sips).
set -e
cd "$(dirname "$0")/../icons"
tmp=$(mktemp -d)
qlmanage -t -s 512 -o "$tmp" icon.svg >/dev/null 2>&1
cp "$tmp/icon.svg.png" icon-512.png
sips -z 192 192 icon-512.png --out icon-192.png >/dev/null
sips -z 180 180 icon-512.png --out apple-touch-icon.png >/dev/null
rm -rf "$tmp"
echo "rendered icon-512.png, icon-192.png, apple-touch-icon.png"
