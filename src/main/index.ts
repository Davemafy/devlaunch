import { app, BrowserWindow, globalShortcut, Menu, Tray } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { preferencesStore, workspaceStore } from './services/store'
import type { WorkspaceLauncher } from './services/launcher'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let launcher: WorkspaceLauncher | null = null
let isQuitting = false
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function workspaceIdFromArgs(argv: string[]) {
  return argv.find((arg) => arg.startsWith('--launch-workspace='))?.slice('--launch-workspace='.length)
}

async function launchFromShortcut(argv: string[], revealDashboard = false) {
  const workspaceId = workspaceIdFromArgs(argv)
  if (!workspaceId || !launcher) return false
  if (revealDashboard) {
    mainWindow?.show()
    mainWindow?.focus()
  }
  const result = await launcher.launch(workspaceId)
  if (result.status === 'already-running') await launcher.focus(workspaceId)
  return true
}

function revealWindow() {
  if (!mainWindow) createWindow(true)
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function registerGlobalLauncher() {
  globalShortcut.unregister('Control+Alt+Space')
  if (!preferencesStore.get().globalLauncher) return
  globalShortcut.register('Control+Alt+Space', () => {
    revealWindow()
    mainWindow?.webContents.send('launcher:open')
  })
}

function createWindow(showOnReady = true) {
  mainWindow = new BrowserWindow({
    width: 1160, height: 760, minWidth: 920, minHeight: 620, show: false,
    backgroundColor: '#0b0c0e', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  if (showOnReady) mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (!isQuitting && preferencesStore.get().minimizeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function rebuildTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'DevLaunch', enabled: false },
    ...workspaceStore.list().map((workspace) => ({
      label: workspace.name,
      click: () => {
        void launcher?.launch(workspace.id).then((result) => {
          if (result?.status === 'already-running') void launcher?.focus(workspace.id)
        })
      }
    })),
    { type: 'separator' },
    { label: 'Open DevLaunch', click: revealWindow },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
  ]))
}

async function createTray() {
  const icon = await app.getFileIcon(process.execPath, { size: 'small' })
  tray = new Tray(icon)
  tray.setToolTip('DevLaunch')
  rebuildTrayMenu()
  tray.on('click', revealWindow)
}

app.on('second-instance', (_event, argv) => {
  void launchFromShortcut(argv).then((handled) => { if (!handled) revealWindow() })
})
app.whenReady().then(() => {
  const workspaceId = workspaceIdFromArgs(process.argv)
  const preferences = preferencesStore.get()
  const background = process.argv.includes('--background') && preferences.startHidden
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: preferences.launchAtLogin, args: ['--background'] })
  launcher = registerIpc({ onWorkspacesChanged: rebuildTrayMenu }).launcher
  createWindow(!workspaceId && !background)
  void createTray()
  registerGlobalLauncher()
  if (workspaceId) mainWindow?.webContents.once('did-finish-load', () => { void launchFromShortcut(process.argv) })
})
app.on('before-quit', () => { isQuitting = true; globalShortcut.unregisterAll() })
