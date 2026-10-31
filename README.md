<p align="center"><img src="public/icon.png" width="128" alt="Space Lens icon"></p>

<h1 align="center">Space Lens</h1>

<p align="center">A private, local-first storage analyzer and cleanup companion for macOS.</p>

<p align="center">
  <a href="https://akifislam.github.io/space-lens/">Website</a> ·
  <a href="https://github.com/akifislam/space-lens/releases/latest/download/Space-Lens-macOS.zip">Download</a> ·
  <a href="#development">Development</a>
</p>

## What it does

Space Lens scans local files on the Mac's internal APFS volume and presents:

- authoritative disk capacity, used space, and free space;
- storage totals by category, extension, and top-level folder;
- installed application sizes from `/Applications` and `/System/Applications`;
- largest cleanup-safe files with Finder reveal actions;
- extension drill-down with individual, select-all, and bulk Trash controls;
- automatic exclusion of iCloud, File Provider, network, and external volumes.

The interface runs entirely on `127.0.0.1`. No file names, paths, or analytics are uploaded.

## Safety model

Space Lens never offers deletion for macOS system paths, `~/Library`, hidden configuration, application containers, preferences, databases, or its own files. Cleanup is restricted to standard personal folders: Desktop, Documents, Downloads, Movies, Music, Pictures, Public, and the user's personal Applications folder. Items are moved to macOS Trash, not permanently erased.

## Install

1. Install [Node.js 18 or newer](https://nodejs.org/).
2. Download `Space-Lens-macOS.zip` from the [latest release](https://github.com/akifislam/space-lens/releases/latest).
3. Unzip it and drag **Space Lens.app** into Applications.
4. Open the app. If Gatekeeper asks, Control-click the app and choose **Open**.
5. For complete scanning, add Space Lens in **System Settings → Privacy & Security → Full Disk Access**.

The release contains a universal launcher for Apple Silicon and Intel Macs. Node.js is intentionally not bundled, keeping the download small and the runtime transparent.

## Development

Requirements: macOS 12+, Node.js 18+, and Xcode Command Line Tools for release packaging.

```bash
npm start
# open http://127.0.0.1:43110
```

Run checks and build the distributable app:

```bash
npm test
./scripts/build-macos.sh
```

The packaged ZIP is written to `dist/Space-Lens-macOS.zip`.

## Architecture

- `server.js` — dependency-free Node.js server, scanner, safety policy, and Trash API
- `public/` — responsive local dashboard and visualizations
- `packaging/` — native Swift launcher, icon, and macOS bundle metadata
- `scripts/build-macos.sh` — universal app and ZIP release builder
- `docs/` — GitHub Pages site

## Privacy and limitations

APFS snapshots, swap, filesystem metadata, sealed system data, and purgeable storage are included in macOS disk usage but cannot always be represented as ordinary files. Space Lens therefore shows authoritative disk statistics separately from analyzed-file totals.

Space Lens is not notarized through the Apple Developer Program. Source and release builds are provided as-is under the MIT License.
