# DevLaunch

Save what is open. Bring it back anytime.

DevLaunch is a Windows desktop workspace launcher for developers who repeatedly reopen the same editor, terminal commands, browser pages, tools, and window layout.

## What it does

- Saves reusable development workspaces
- Starts commands in dependency order
- Opens editors, external tools, and browser URLs
- Waits for HTTP, TCP, or process health checks
- Tracks processes started by DevLaunch
- Stops, restarts, or focuses a running workspace
- Captures and restores window positions across multiple monitors
- Supports workspace modes, desktop shortcuts, the system tray, and keyboard launching

## Stack

- Electron
- React
- TypeScript
- electron-vite
- electron-store
- Zod

## Development

DevLaunch currently targets Windows.

```bash
npm install
npm run dev
```

Run validation:

```bash
npm run typecheck
npm test
npm run build
```

Create Windows packages:

```bash
npm run package:win
```

Packaged files are written to `release/`.

## Repository status

This repository starts from the last complete, buildable TypeScript source snapshot: **v1.1.0**.

DevLaunch was tested further through runtime patch builds up to v2.2.2. Those patches improved open-app capture, staged restore, browser grouping and profiles, Store-app activation, shortcut icons, overflow handling, and shutdown reliability. Because those iterations were produced against packaged output, they are being ported back into TypeScript before they are represented here as source.

The repository deliberately does not claim that compiled-only changes are maintainable source code.

## Privacy

Workspace definitions and launch history stay on the user's machine. Personal workspace data, browser data, local paths, and generated release artifacts are excluded from the repository.

## Licence

MIT © David Imafidon
