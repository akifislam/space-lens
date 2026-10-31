#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
APP="$DIST_DIR/Space Lens.app"
ZIP="$DIST_DIR/Space-Lens-macOS.zip"
rm -rf "$DIST_DIR"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"
clang -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 "$PROJECT_DIR/packaging/Launcher.c" -o "$APP/Contents/MacOS/SpaceLens"
cp "$PROJECT_DIR/packaging/Info.plist" "$APP/Contents/Info.plist"
cp "$PROJECT_DIR/packaging/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp "$PROJECT_DIR/server.js" "$PROJECT_DIR/package.json" "$APP/Contents/Resources/app/"
cp -R "$PROJECT_DIR/public" "$APP/Contents/Resources/app/public"
chmod +x "$APP/Contents/MacOS/SpaceLens"
codesign --force --deep --sign - "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
codesign --verify --deep --strict "$APP"
echo "Built: $ZIP"
