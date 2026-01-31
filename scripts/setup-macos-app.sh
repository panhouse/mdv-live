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
        do shell script "nohup $MDV_PATH " & quoted form of filePath & " > /dev/null 2>&1 &"
    end repeat
end open

on run
    display dialog "MDV Markdown Viewer

Usage:
- Double-click any .md file
- Drag & drop .md files onto this app

Version: 0.3.0 (Node.js)" buttons {"OK"} default button "OK" with title "MDV"
end run
EOF

echo "Compiling AppleScript..."
osacompile -o "$TEMP_DIR/$APP_NAME" "$TEMP_DIR/MDV.applescript"

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
	<string>0.3.0</string>
	<key>CFBundleVersion</key>
	<string>0.3.0</string>
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
