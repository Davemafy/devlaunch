import { contextBridge, ipcRenderer } from 'electron'
import type { DevLaunchAPI, LaunchEvent, LayoutCaptureOptions, LayoutWindowSelection, OpenWorkspaceCapture, Preferences, ProcessInfo, Workspace } from '../shared/types'

const api: DevLaunchAPI = {
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  saveWorkspace: (workspace: Workspace) => ipcRenderer.invoke('workspace:save', workspace),
  deleteWorkspace: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  createDesktopShortcut: (id: string) => ipcRenderer.invoke('workspace:create-desktop-shortcut', id),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  chooseExecutable: () => ipcRenderer.invoke('executable:choose'),
  detectProject: (path: string) => ipcRenderer.invoke('project:detect', path),
  launchWorkspace: (id: string, behavior = 'normal', modeId?: string) => ipcRenderer.invoke('workspace:launch', id, behavior, modeId),
  focusWorkspace: (id: string) => ipcRenderer.invoke('workspace:focus', id),
  restartWorkspace: (id: string, modeId?: string) => ipcRenderer.invoke('workspace:restart', id, modeId),
  stopWorkspace: (id: string) => ipcRenderer.invoke('workspace:stop', id),
  restartProcess: (workspaceId: string, commandId: string) => ipcRenderer.invoke('process:restart', workspaceId, commandId),
  getProcesses: (id?: string) => ipcRenderer.invoke('process:list', id),
  getRuntime: (id: string) => ipcRenderer.invoke('workspace:runtime', id),
  previewCurrentLayout: (id: string) => ipcRenderer.invoke('workspace:preview-layout', id),
  previewOpenWindows: () => ipcRenderer.invoke('workspace:preview-open-windows'),
  createWorkspaceFromOpenWindows: (capture: OpenWorkspaceCapture) => ipcRenderer.invoke('workspace:create-from-open-windows', capture),
  captureCurrentLayout: (id: string, selections?: LayoutWindowSelection[], options?: LayoutCaptureOptions) => ipcRenderer.invoke('workspace:capture-layout', id, selections, options),
  restoreLayout: (id: string, layoutId?: string) => ipcRenderer.invoke('workspace:restore-layout', id, layoutId),
  openExternal: (url: string, browser?: string) => ipcRenderer.invoke('url:open', url, browser),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  savePreferences: (preferences: Preferences) => ipcRenderer.invoke('preferences:save', preferences),
  onLaunchEvent: (callback: (event: LaunchEvent) => void) => { const listener = (_: unknown, event: LaunchEvent) => callback(event); ipcRenderer.on('launch:event', listener); return () => ipcRenderer.removeListener('launch:event', listener) },
  onProcessUpdate: (callback: (process: ProcessInfo) => void) => { const listener = (_: unknown, info: ProcessInfo) => callback(info); ipcRenderer.on('process:update', listener); return () => ipcRenderer.removeListener('process:update', listener) },
  onTrayLaunch: (callback: (workspaceId: string) => void) => { const listener = (_: unknown, id: string) => callback(id); ipcRenderer.on('tray:launch', listener); return () => ipcRenderer.removeListener('tray:launch', listener) }
  ,onOpenLauncher: (callback: () => void) => { const listener = () => callback(); ipcRenderer.on('launcher:open', listener); return () => ipcRenderer.removeListener('launcher:open', listener) }
}
contextBridge.exposeInMainWorld('devlaunch', api)
