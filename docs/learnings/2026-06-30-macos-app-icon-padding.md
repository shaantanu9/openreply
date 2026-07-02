# Learnings — macOS app icon padding for Cmd+Tab / Finder

**Date:** 2026-06-30
**Context:** OpenReply Tauri app icon looked oversized in macOS Cmd+Tab / Finder and was not highlighting properly in the app switcher.

---

## Problem

The macOS app icon (`app-tauri/src-tauri/icons/icon.icns`) filled almost the entire canvas. On macOS this made it visually larger than surrounding app icons in the Dock and Cmd+Tab switcher, and the selection highlight did not render correctly.

## Fix

Only the macOS `.icns` file needed to change. The rest of the icon set (iOS, Android, Windows PNGs, `icon.png`, `icon.ico`) was left as-is.

### Steps

1. Create a temporary `.iconset` directory with the standard macOS sizes, scaling the artwork down to ~85 % and centering it with transparent padding:

```bash
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

2. Compile the `.iconset` into `icon.icns`:

```bash
iconutil -c icns /tmp/OpenReply.iconset -o icons/icon.icns
```

3. Remove the temporary `.iconset` directory.

### Result

- The robot artwork is now smaller within the icon, with transparent padding around it.
- The icon aligns better with other macOS app icons in Cmd+Tab / Finder.
- The selection highlight should now render correctly.

---

## Reference

- File changed: `app-tauri/src-tauri/icons/icon.icns`
- Tauri config: `app-tauri/src-tauri/tauri.conf.json`

## Rule of thumb

For macOS app-switcher icons, keep the main content within ~75–85 % of the canvas height. Going edge-to-edge causes the icon to look oversized and can interfere with system highlights.
