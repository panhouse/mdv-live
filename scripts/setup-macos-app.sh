#!/bin/bash
# MDV macOS App Setup Script
# Finderから.mdファイルをダブルクリックでMDVを開けるようにする

set -e

echo "=== MDV macOS App Setup ==="
echo ""

# mdvコマンドの場所を確認
MDV_PATH=$(which mdv 2>/dev/null || true)

if [ -z "$MDV_PATH" ]; then
    echo "Error: mdv command not found."
    echo "Please install mdv first: npm install -g mdv-live"
    exit 1
fi

echo "Found mdv at: $MDV_PATH"
echo ""

# 一時ディレクトリ
TEMP_DIR=$(mktemp -d)
APP_NAME="MDV.app"
APP_PATH="/Applications/$APP_NAME"

# AppleScript作成
cat << EOF > "$TEMP_DIR/MDV.applescript"
-- MDV Markdown Viewer Launcher

on open theFiles
    repeat with theFile in theFiles
        set filePath to POSIX path of theFile
        -- Run launcher (will return after opening browser)
        do shell script "/Applications/MDV.app/Contents/Resources/launch.sh " & quoted form of filePath
    end repeat
end open

on run
    display dialog "MDV Markdown Viewer

Usage:
- Double-click any .md file
- Drag & drop .md files onto this app

Version: 0.3.1 (Node.js)" buttons {"OK"} default button "OK" with title "MDV"
end run
EOF

echo "Compiling AppleScript..."
osacompile -o "$TEMP_DIR/$APP_NAME" "$TEMP_DIR/MDV.applescript"

# Create launcher script
echo "Creating launcher script..."
cat > "$TEMP_DIR/$APP_NAME/Contents/Resources/launch.sh" << 'LAUNCHSCRIPT'
#!/bin/bash
# Set PATH for node (AppleScript environment doesn't have user's PATH)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

exec >> /tmp/mdv-debug.log 2>&1
echo "=== $(date) ==="
echo "FILE_PATH: $1"

FILE_PATH="$1"
FILE_NAME=$(basename "$FILE_PATH")
LOG="/tmp/mdv-$$.log"

# URL-encode the filename (handles Japanese characters)
ENCODED_NAME=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$FILE_NAME")

echo "Starting MDV..."
# Start MDV
MDV_PATH_HERE --no-browser "$FILE_PATH" > "$LOG" 2>&1 &

# Wait for server (max 5 sec)
for i in {1..25}; do
    sleep 0.2
    PORT=$(grep -o 'localhost:[0-9]*' "$LOG" 2>/dev/null | head -1 | cut -d: -f2)
    if [ -n "$PORT" ]; then
        echo "Found port: $PORT"
        echo "Opening browser..."
        open "http://localhost:$PORT?path=$ENCODED_NAME"
        echo "Done"
        exit 0
    fi
done

echo "Timeout - using fallback"
# Fallback
open "http://localhost:8642?path=$ENCODED_NAME"
LAUNCHSCRIPT

# Replace placeholder with actual path
sed -i '' "s|MDV_PATH_HERE|$MDV_PATH|g" "$TEMP_DIR/$APP_NAME/Contents/Resources/launch.sh"
chmod +x "$TEMP_DIR/$APP_NAME/Contents/Resources/launch.sh"

# Info.plist設定
cat << 'EOF' > "$TEMP_DIR/$APP_NAME/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>com.panhouse.mdv</string>
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>Markdown Document</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>net.daringfireball.markdown</string>
				<string>public.plain-text</string>
			</array>
			<key>CFBundleTypeExtensions</key>
			<array>
				<string>md</string>
				<string>markdown</string>
				<string>mdown</string>
			</array>
		</dict>
	</array>
	<key>CFBundleExecutable</key>
	<string>droplet</string>
	<key>CFBundleName</key>
	<string>MDV</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.3.1</string>
	<key>CFBundleVersion</key>
	<string>0.3.1</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.13</string>
</dict>
</plist>
EOF

echo "Signing app..."
codesign --force --deep --sign - "$TEMP_DIR/$APP_NAME"

# 既存のアプリを削除してインストール
if [ -d "$APP_PATH" ]; then
    echo "Removing existing $APP_PATH..."
    rm -rf "$APP_PATH"
fi

echo "Installing to $APP_PATH..."
cp -R "$TEMP_DIR/$APP_NAME" "$APP_PATH"

# Remove quarantine attribute to prevent Gatekeeper warning
echo "Removing quarantine attribute..."
xattr -cr "$APP_PATH"

# LaunchServices登録
echo "Registering with LaunchServices..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"

# クリーンアップ
rm -rf "$TEMP_DIR"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "MDV.app has been installed to /Applications"
echo ""
echo "To set MDV as the default app for .md files:"
echo "1. Right-click any .md file in Finder"
echo "2. Select 'Get Info'"
echo "3. Under 'Open with', select 'MDV'"
echo "4. Click 'Change All...'"
echo ""
