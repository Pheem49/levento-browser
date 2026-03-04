# Levento AI Browser

Levento is an Electron-based desktop browser with a built-in AI side panel, tab management, session restore, and Linux AppImage release flow.

## Features

- Multi-tab browser UI with favicon/title tabs
- Smart address bar
  - URL detection
  - Search fallback (`https://www.google.com/search?q=...`)
  - Suggestions + history
- Keyboard shortcuts
  - `Ctrl/Cmd + L` focus address bar
  - `Ctrl/Cmd + T` new tab
  - `Ctrl/Cmd + W` close current tab
  - `Ctrl/Cmd + Tab` next tab
  - `Ctrl/Cmd + Shift + Tab` previous tab
- Session restore (reopen last tabs after relaunch)
- AI sidebar
  - Model selection (Ollama / Gemini)
  - Page summarize and page-context Q&A
- GPU Safe Mode toggle in Settings (for unstable GPU drivers)
- Open Data Folder button in Settings
- Baseline security hardening
  - Sandbox enabled
  - Permission lockdown (deny by default except fullscreen)
  - Webview blocked
  - Unsafe navigation schemes blocked
  - Popup policy (`window.open`) denied in-app
  - DevTools toggle disabled in packaged app
- Basic ad-block filtering for common ad domains (with YouTube context excluded)

## Tech Stack

- Electron (`main.js`, `preload.js`, `renderer.js`)
- Plain HTML/CSS/JS
- `electron-builder` for packaging

## Project Structure

- `main.js` Electron main process, tabs, security, IPC, updater
- `preload.js` secure bridge (`window.browserAPI`)
- `renderer.js` UI logic, tabs, address bar, settings, AI
- `index.html` app layout
- `style.css` app styles
- `assets/` icons

## Requirements

- Node.js 18+
- npm
- Linux desktop environment for local run/build (for AppImage target)

## Install & Run

```bash
npm install
npm start
```

## Build

```bash
# all configured targets
npm run build

# Linux AppImage
npm run build:linux

# Windows NSIS
npm run build:win
```

Build output is in `dist/`.

## Linux AppImage (stable symlink)

After build, create/update a stable file name:

```bash
ln -sfn "$PWD/dist/Levento AI Browser-$(node -p "require('./package.json').version").AppImage" "$PWD/dist/levento-browser.AppImage"
```

Run:

```bash
./dist/levento-browser.AppImage
```

## Release Flow (GitHub)

1. Bump version in `package.json`
2. Build Linux package:
   ```bash
   npm run build:linux
   ```
3. Create release with AppImage:
   ```bash
   gh release create vX.Y.Z "dist/Levento AI Browser-X.Y.Z.AppImage"
   ```
4. Upload updater metadata:
   ```bash
   gh release upload vX.Y.Z dist/latest-linux.yml
   ```

If a release is pre-release and you want it as Latest:

```bash
gh release edit vX.Y.Z --prerelease=false --latest
```

## Data Location

On Linux, user data is stored at:

`~/.config/levento-browser`

Typical files/folders:

- `tabs-session.json` (session restore)
- `gpu-fallback.json` (GPU Safe Mode/fallback state)
- `Cookies`, `Local Storage/`, `IndexedDB/`, `Session Storage/`, etc.

You can open this folder from **Settings > Open Data Folder**.

## Notes

- GPU issues on some Linux drivers can cause stutter/crashes. Enable **GPU Safe Mode** and restart the app.
- DRM-heavy streaming behavior may differ from Chrome/Firefox.
- Ad-blocking is baseline-level (domain-based), not a full replacement for advanced filter-list engines.

## License

ISC
