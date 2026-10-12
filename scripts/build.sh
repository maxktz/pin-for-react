#!/bin/sh
# Builds the store upload: dist/pin-for-react-<version>.zip with only what the extension loads.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="dist/pin-for-react-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -X -r "$out" manifest.json background.js bridge.js pin.js options.html options.js icons LICENSE
echo "$out ($(du -h "$out" | cut -f1))"
unzip -l "$out"
