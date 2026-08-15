import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { workspaceStore } from './services/store'
import { preferencesStore } from './services/store'
import { detectProject } from './services/projectDetector'
import { ProcessManager } from './services/processManager'
import { WorkspaceLauncher } from './services/launcher'
import type { Workspace } from '../shared/types'
import { createWorkspaceDesktopShortcut } from './platform/windows/desktopShortcut'
import { captureSelectedOpenWindows, previewOpenWindows } from './platform/windows/windowPosition'

const id = z.string().min(1).max(200)
const healthCheckSchema = z.object({
  type: z.enum(['http', 'tcp', 'process']), target: z.string().min(1).max(2000),
  timeout: z.number().int().min(1000).max(120000).optional(), interval: z.number().int().min(200).max(5000).optional()
})
const commandSchema = z.object({
  id, name: z.string().min(1).max(100), command: z.string().min(1).max(2000), cwd: z.string().max(1000).optional(),
  runOnLaunch: z.boolean(), waitForUrl: z.string().url().optional(), healthCheck: healthCheckSchema.optional(),
  dependsOn: z.array(id).max(20).optional(), order: z.number().int().min(0).max(1000)
})
const urlSchema = z.object({
  id, name: z.string().min(1).max(100), url: z.string().url(), browser: z.string().max(200).optional(),
  openOnLaunch: z.boolean(), waitForReady: z.boolean().optional(), groupId: id.optional()
})
const appSchema = z.object({
  id, name: z.string().min(1).max(100), executable: z.string().min(1).max(1000), args: z.array(z.string().max(1000)).max(50).optional(), openOnLaunch: z.boolean()
})
const boundsSchema = z.object({ x: z.number().min(-0.25).max(1.25), y: z.number().min(-0.25).max(1.25), width: z.number().min(0.05).max(1.5), height: z.number().min(0.05).max(1.5) })
const displaySchema = z.object({
  deviceName: z.string().min(1).max(200), index: z.number().int().min(0).max(32), primary: z.boolean(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  workingArea: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
})
const layoutSchema = z.object({
  version: z.literal(1), capturedAt: z.string(), displays: z.array(displaySchema).max(32),
  windows: z.array(z.object({
    id, target: z.enum(['editor', 'url', 'browser-group', 'app']), targetId: id.optional(), name: z.string().min(1).max(100),
    processName: z.string().max(200), title: z.string().max(1000), titlePattern: z.string().max(160),
    displayDeviceName: z.string().min(1).max(200), displayIndex: z.number().int().min(0).max(32), bounds: boundsSchema, maximized: z.boolean().optional()
  })).max(50)
})
const layoutSelectionSchema = z.array(z.object({ targetId: id, windowHandle: z.string().regex(/^\d{1,24}$/) })).max(50)
const namedLayoutSchema = z.object({ id, name: z.string().min(1).max(100), modeId: id.optional(), layout: layoutSchema })
const browserGroupSchema = z.object({ id, name: z.string().min(1).max(100), browser: z.string().max(200).optional(), profile: z.string().max(200).optional() })
const modeSchema = z.object({
  id, name: z.string().min(1).max(100), description: z.string().max(300).optional(),
  commandIds: z.array(id).max(20).optional(), urlIds: z.array(id).max(30).optional(), appIds: z.array(id).max(20).optional(), layoutId: id.optional()
})
const layoutOptionsSchema = z.object({ id, name: z.string().min(1).max(100), modeId: id.optional(), makeDefault: z.boolean().optional() })
const openWorkspaceCaptureSchema = z.object({
  name: z.string().trim().min(1).max(100),
  windowHandles: z.array(z.string().regex(/^\d{1,24}$/)).min(1).max(30),
  createDesktopShortcut: z.boolean().optional()
})
const preferencesSchema = z.object({ launchAtLogin: z.boolean(), startHidden: z.boolean(), minimizeToTray: z.boolean(), defaultBrowser: z.enum(['Chrome', 'Edge', 'System']), globalLauncher: z.boolean().default(true), notifications: z.boolean().default(true) })
const workspaceSchema = z.object({
  id, name: z.string().min(1).max(100), projectPath: z.string().min(1).max(1000),
  framework: z.string().optional(), editor: z.object({ command: z.string().min(1), args: z.array(z.string()).optional() }).optional(),
  browser: z.string().optional(), commands: z.array(commandSchema).max(20), urls: z.array(urlSchema).max(30), apps: z.array(appSchema).max(20),
  browserGroups: z.array(browserGroupSchema).max(20).optional(), modes: z.array(modeSchema).max(20).optional(),
  layout: layoutSchema.optional(), layouts: z.array(namedLayoutSchema).max(20).optional(), defaultLayoutId: id.optional(),
  createdAt: z.string(), updatedAt: z.string(), lastLaunchedAt: z.string().optional(), lastReadyTimeMs: z.number().optional()
})

export function registerIpc(options: { onWorkspacesChanged?: () => void } = {}) {
  const processes = new ProcessManager()
  const launcher = new WorkspaceLauncher(processes)
  processes.on('update', (info) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('process:update', info)))

  ipcMain.handle('workspace:list', () => workspaceStore.list())
  ipcMain.handle('workspace:save', (_event, raw) => {
    const workspaces = workspaceStore.save(workspaceSchema.parse(raw) as Workspace)
    options.onWorkspacesChanged?.()
    return workspaces
  })
  ipcMain.handle('workspace:delete', (_event, raw) => {
    const workspaces = workspaceStore.delete(id.parse(raw))
    options.onWorkspacesChanged?.()
    return workspaces
  })
  ipcMain.handle('workspace:create-desktop-shortcut', (_event, raw) => {
    const workspace = workspaceStore.get(id.parse(raw))
    if (!workspace) throw new Error('Workspace not found')
    return createWorkspaceDesktopShortcut(workspace)
  })
  ipcMain.handle('workspace:preview-open-windows', () => previewOpenWindows())
  ipcMain.handle('workspace:create-from-open-windows', async (_event, raw) => {
    const capture = openWorkspaceCaptureSchema.parse(raw)
    const candidates = await previewOpenWindows()
    const selected = capture.windowHandles.map((handle) => candidates.find((item) => item.handle === handle)).filter((item): item is NonNullable<typeof item> => Boolean(item?.executable))
    if (!selected.length) throw new Error('The selected windows are no longer open')

    const appByExecutable = new Map<string, { id: string; name: string; executable: string }>()
    for (const window of selected) {
      const key = window.executable!.toLowerCase()
      if (!appByExecutable.has(key)) appByExecutable.set(key, { id: randomUUID(), name: window.processName, executable: window.executable! })
    }
    const layout = await captureSelectedOpenWindows(selected.map((window) => {
      const capturedApp = appByExecutable.get(window.executable!.toLowerCase())!
      return { handle: window.handle, id: capturedApp.id, name: window.title || capturedApp.name }
    }))
    if (!layout.windows.length) throw new Error('The selected windows could not be captured')

    const now = new Date().toISOString()
    const layoutId = randomUUID()
    const workspace: Workspace = {
      id: randomUUID(), name: capture.name, projectPath: app.getPath('home'), framework: 'Captured workspace',
      commands: [], urls: [], apps: [...appByExecutable.values()].map((item) => ({ ...item, openOnLaunch: true })),
      layouts: [{ id: layoutId, name: 'Captured layout', layout }], defaultLayoutId: layoutId,
      createdAt: now, updatedAt: now
    }
    const workspaces = workspaceStore.save(workspace)
    options.onWorkspacesChanged?.()
    let shortcutCreated = false
    if (capture.createDesktopShortcut) {
      try { await createWorkspaceDesktopShortcut(workspace); shortcutCreated = true } catch { /* workspace remains saved */ }
    }
    return { workspaces, workspace, shortcutCreated }
  })
  ipcMain.handle('folder:choose', async () => (await dialog.showOpenDialog({ properties: ['openDirectory'] })).filePaths[0] || null)
  ipcMain.handle('executable:choose', async () => (await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['exe', 'cmd', 'bat'] }] })).filePaths[0] || null)
  ipcMain.handle('preferences:get', () => preferencesStore.get())
  ipcMain.handle('preferences:save', (_event, raw) => {
    const preferences = preferencesStore.save(preferencesSchema.parse(raw))
    app.setLoginItemSettings({ openAtLogin: preferences.launchAtLogin, args: ['--background'] })
    return preferences
  })
  ipcMain.handle('project:detect', (_event, raw) => detectProject(z.string().min(1).max(1000).parse(raw)))
  ipcMain.handle('workspace:launch', (_event, rawId, rawBehavior, rawModeId) => launcher.launch(id.parse(rawId), z.enum(['normal', 'another', 'use-existing']).optional().parse(rawBehavior) || 'normal', id.optional().parse(rawModeId)))
  ipcMain.handle('workspace:focus', (_event, raw) => launcher.focus(id.parse(raw)))
  ipcMain.handle('workspace:restart', (_event, raw, rawModeId) => launcher.restart(id.parse(raw), id.optional().parse(rawModeId)))
  ipcMain.handle('workspace:stop', (_event, raw) => launcher.stop(id.parse(raw)))
  ipcMain.handle('workspace:runtime', (_event, raw) => launcher.getRuntime(id.parse(raw)))
  ipcMain.handle('workspace:preview-layout', (_event, raw) => launcher.previewLayout(id.parse(raw)))
  ipcMain.handle('workspace:capture-layout', (_event, raw, selections, options) => launcher.captureLayout(id.parse(raw), layoutSelectionSchema.optional().parse(selections), layoutOptionsSchema.optional().parse(options)))
  ipcMain.handle('workspace:restore-layout', (_event, raw, rawLayoutId) => launcher.restoreLayout(id.parse(raw), id.optional().parse(rawLayoutId)))
  ipcMain.handle('process:list', (_event, raw) => processes.get(raw ? id.parse(raw) : undefined))
  ipcMain.handle('process:restart', async (_event, rawWorkspaceId, rawCommandId) => {
    const workspaceId = id.parse(rawWorkspaceId); const commandId = id.parse(rawCommandId)
    const workspace = workspaceStore.get(workspaceId); const command = workspace?.commands.find((item) => item.id === commandId)
    if (!workspace || !command) throw new Error('Command not found')
    await processes.stop(workspaceId, commandId); processes.start(workspaceId, command, workspace.projectPath)
  })
  ipcMain.handle('url:open', (_event, rawUrl, browser) => launcher.openUrl(z.string().url().parse(rawUrl), z.string().optional().parse(browser)))
  return { launcher }
}
