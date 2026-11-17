#!/bin/bash
# Builds a personal, double-clickable installer for the Mac uploader.
# Usage: build-installer.sh SITE_URL UPLOAD_KEY OUTPUT_FILE
# The output contains the upload key, so keep it out of the repo.
set -euo pipefail
SITE_URL="$1"; UPLOAD_KEY="$2"; OUT="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_B64=$(base64 < "$HERE/thesis-uploader.sh" | tr -d '\n')

cat > "$OUT" <<INSTALLER
#!/bin/bash
# Installs the Thesis uploader on this Mac. Double-click to run.
# After installing, this file deletes itself because it contains your upload key.
set -euo pipefail
LABEL="com.sanderrandoja.thesis-uploader"
APP_DIR="\$HOME/Library/Application Support/ThesisUploader"
WATCH_DIR="\$HOME/Thesis Recordings"
PLIST="\$HOME/Library/LaunchAgents/\$LABEL.plist"
LOG="\$HOME/Library/Logs/ThesisUploader.log"
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"

say() { printf '\n\033[1m%s\033[0m\n' "\$*"; }
say "Setting up the Thesis uploader"

mkdir -p "\$APP_DIR" "\$WATCH_DIR/Uploaded" "\$HOME/Library/LaunchAgents" "\$HOME/Library/Logs"
echo '$SCRIPT_B64' | base64 -D > "\$APP_DIR/thesis-uploader.sh"
chmod 755 "\$APP_DIR/thesis-uploader.sh"
umask 077
cat > "\$APP_DIR/config" <<CONFIG
SITE_URL="$SITE_URL"
UPLOAD_KEY="$UPLOAD_KEY"
WATCH_DIR="\$WATCH_DIR"
CONFIG
chmod 600 "\$APP_DIR/config"
umask 022

say "Checking the video compressor (ffmpeg)"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is installed."
elif command -v brew >/dev/null 2>&1; then
  echo "Installing ffmpeg with Homebrew. This can take a few minutes."
  brew install ffmpeg
else
  echo "ffmpeg isn't installed and Homebrew isn't either."
  echo "Uploads will still work using macOS's built-in converter, but without a preview frame."
  echo "For the best result, install Homebrew from https://brew.sh, then run: brew install ffmpeg"
fi

say "Checking the connection to your site"
code=\$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$SITE_URL/api/ingest" \
  -H "authorization: Bearer $UPLOAD_KEY" -H 'content-type: application/json' --data '{"action":"ping"}' || true)
if [ "\$code" = 200 ]; then echo "Connected."; else echo "The site answered \$code. Uploads will retry automatically; ask Claude if this keeps happening."; fi

say "Starting the background helper"
cat > "\$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>\$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>\$APP_DIR/thesis-uploader.sh</string></array>
  <key>WatchPaths</key><array><string>\$WATCH_DIR</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>Nice</key><integer>5</integer>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>\$LOG</string>
  <key>StandardErrorPath</key><string>\$LOG</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/\$(id -u)/\$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/\$(id -u)" "\$PLIST"
echo "Running. It checks the folder whenever something lands in it."

cat > "\$APP_DIR/Uninstall Thesis Uploader.command" <<'UNINSTALL'
#!/bin/bash
launchctl bootout "gui/\$(id -u)/com.sanderrandoja.thesis-uploader" 2>/dev/null || true
rm -f "\$HOME/Library/LaunchAgents/com.sanderrandoja.thesis-uploader.plist"
rm -rf "\$HOME/Library/Application Support/ThesisUploader"
echo "The Thesis uploader is removed. Your Thesis Recordings folder and its videos are untouched."
UNINSTALL
chmod 755 "\$APP_DIR/Uninstall Thesis Uploader.command"

say "Where should Cmd+Shift+5 save screen recordings?"
echo "macOS saves screenshots and screen recordings to the same place."
read -r -p "Save them to Thesis Recordings from now on? Screenshots will go there too. [y/N] " answer || answer=""
case "\$answer" in
  [yY]*) defaults write com.apple.screencapture location "\$WATCH_DIR"; killall SystemUIServer 2>/dev/null || true
         echo "Done. Recordings now save straight into Thesis Recordings." ;;
  *)     echo "Unchanged. Choose it per recording in Cmd+Shift+5 → Options → Other Location, or export from Screen Studio into the folder." ;;
esac

say "All set"
echo "Drop or save a recording into: \$WATCH_DIR"
echo "It appears on the site in New about a minute after it finishes saving."
echo "Activity log: \$LOG"
open "\$WATCH_DIR"
rm -f -- "\$0"
INSTALLER
chmod 755 "$OUT"
echo "Built $OUT"
