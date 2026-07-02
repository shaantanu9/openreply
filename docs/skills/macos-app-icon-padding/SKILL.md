---
name: macos-app-icon-padding
description: "Resize only the macOS app icon (.icns) used in Cmd+Tab and Finder so it matches other app icons and highlights correctly. Use when the user reports the app icon looks too big, is clipped, or does not highlight in the app switcher."
trigger: "app icon too big | icon highlight | Cmd+Tab icon | dock icon size | resize app icon | macOS app icon"
---

# macos-app-icon-padding

Fix an oversized macOS app icon by rebuilding only `icon.icns`. Do not touch iOS, Android, or Windows icon assets unless the user explicitly asks.

## When to use

- The app icon looks larger than neighboring icons in the macOS Dock or Cmd+Tab switcher.
- The Cmd+Tab highlight does not appear around the icon.
- The icon content touches or bleeds past the icon edges.

## Root cause

macOS app icons expect the main artwork to sit inside a safe area (roughly 75–85 % of the canvas). If the artwork fills the entire icon, the generated `.icns` looks oversized and system highlights may not render correctly.

## Fix

### 1. Create a temporary `.iconset`

Scale the source artwork to ~85 % and center it on each standard macOS canvas:

```bash
cd app-tauri/src-tauri
mkdir -p /tmp/OpenReply.iconset

magick icons/icon.png -resize 85% -gravity center -extent 1024x1024 -background none /tmp/OpenReply.iconset/icon_512x512@2x.png
magick icons/icon.png -resize 85% -gravity center -extent 512x512   -background none /tmp/OpenReply.iconset/icon_512x512.png
magick icons/icon.png -resize 85% -gravity center -extent 512x512   -background none /tmp/OpenReply.iconset/icon_256x256@2x.png
magick icons/icon.png -resize 85% -gravity center -extent 256x256   -background none /tmp/OpenReply.iconset/icon_256x256.png
magick icons/icon.png -resize 85% -gravity center -extent 256x256   -background none /tmp/OpenReply.iconset/icon_128x128@2x.png
magick icons/icon.png -resize 85% -gravity center -extent 128x128   -background none /tmp/OpenReply.iconset/icon_128x128.png
magick icons/icon.png -resize 85% -gravity center -extent 128x128   -background none /tmp/OpenReply.iconset/icon_32x32@2x.png
magick icons/icon.png -resize 85% -gravity center -extent 64x64     -background none /tmp/OpenReply.iconset/icon_32x32.png
magick icons/icon.png -resize 85% -gravity center -extent 64x64     -background none /tmp/OpenReply.iconset/icon_16x16@2x.png
magick icons/icon.png -resize 85% -gravity center -extent 32x32     -background none /tmp/OpenReply.iconset/icon_16x16.png
```

If the artwork still looks too large after 85 %, try 80 %.

### 2. Compile the `.icns`

```bash
iconutil -c icns /tmp/OpenReply.iconset -o icons/icon.icns
```

### 3. Verify only `icon.icns` changed

```bash
git status --short icons/
```

You should see only `M icons/icon.icns`.

### 4. Clean up

```bash
rm -rf /tmp/OpenReply.iconset
```

## Files involved

- `app-tauri/src-tauri/icons/icon.icns` — macOS app icon shown in Cmd+Tab / Finder
- `app-tauri/src-tauri/icons/icon.png` — source artwork (left unchanged)
- `app-tauri/src-tauri/tauri.conf.json` — references `icons/icon.icns`

## Anti-patterns

- Do not regenerate all platform icons with `npx tauri icon` unless the user asks for cross-platform changes.
- Do not crop the artwork; scale it down and add transparent padding.

## Verification

- Build the Tauri app for macOS.
- Check the icon in Finder and the Cmd+Tab switcher.
- Confirm the selection highlight appears correctly.
