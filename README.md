# DevLaunch

**Save what is open. Bring it back later.**

DevLaunch is a Windows desktop app for capturing a workspace and restoring it later in one action.

Instead of reopening the same apps, browser pages, projects and tools every time you come back to something, DevLaunch saves that setup as a workspace you can restore when you need it again.

<img width="1082" height="608" alt="image" src="https://github.com/user-attachments/assets/52929fa9-a77b-4737-bb69-75778fd68c56" />


## What it does

* Captures currently open apps and workspace resources
* Saves captured workspaces locally
* Restores multiple apps and resources from one action
* Lets you keep different workspaces for different projects or tasks
* Runs as a Windows desktop app using Electron

The basic idea is simple:

```text
Open everything you need
        ↓
      Capture
        ↓
   Save workspace
        ↓
 Close everything
        ↓
      Restore
        ↓
 Continue where you left off
```

## Why I built it

I kept reopening the same development setup whenever I returned to a project.

VS Code, terminal, browser pages, localhost, design tools and whatever else I was using.

Bookmarks could save links, but not the whole working context. I wanted something closer to a save button for the desktop.

That became DevLaunch.

## Current status

DevLaunch is still in development.

The capture and restore flow works, but I am still improving how reliably different applications and browser sessions come back, especially across cold starts and different app states.

Some of the problems I am currently working through include:

* restoring browser sessions with the correct profile
* reopening multiple resources without creating unnecessary windows
* improving application detection during capture
* cleaning up Electron processes correctly when DevLaunch exits

## Tech

* Electron
* TypeScript
* Node.js
* Local persistence
* Windows process APIs

## Run locally

```bash
git clone https://github.com/Davemafy/devlaunch.git
cd devlaunch
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Project structure

```text
devlaunch/
├── src/          # application source
├── tests/        # capture and restore tests
├── build/        # desktop build assets
├── .github/      # GitHub configuration
└── package.json
```

## Direction

The goal is not only to restore a development environment.

DevLaunch is meant to capture a working context, save it, and bring it back later without making you rebuild that setup manually every time.
