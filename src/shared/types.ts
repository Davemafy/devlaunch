export type CommandState = 'stopped' | 'starting' | 'waiting' | 'ready' | 'running' | 'failed' | 'degraded'
export type LaunchStepState = 'pending' | 'active' | 'complete' | 'failed' | 'skipped'
export type RuntimeWorkspaceStatus = 'stopped' | 'launching' | 'running' | 'degraded' | 'stopping' | 'failed'

export type HealthCheck = {
  type: 'http' | 'tcp' | 'process'
  target: string
  timeout?: number
  interval?: number
}

export type WorkspaceCommand = {
  id: string
  name: string
  command: string
  cwd?: string
  runOnLaunch: boolean
  waitForUrl?: string
  healthCheck?: HealthCheck
  dependsOn?: string[]
  order: number
}

export type WorkspaceURL = {
  id: string
  name: string
  url: string
  browser?: string
  openOnLaunch: boolean
  waitForReady?: boolean
  groupId?: string
}

export type WorkspaceBrowserGroup = {
  id: string
  name: string
  browser?: string
  profile?: string
}

export type WorkspaceApp = {
  id: string
  name: string
  executable: string
  args?: string[]
  openOnLaunch: boolean
}

export type NormalizedBounds = { x: number; y: number; width: number; height: number }
export type DisplaySnapshot = {
  deviceName: string
  index: number
  primary: boolean
  bounds: { x: number; y: number; width: number; height: number }
  workingArea: { x: number; y: number; width: number; height: number }
}
export type CapturedLayoutWindow = {
  id: string
  target: 'editor' | 'url' | 'browser-group' | 'app'
  targetId?: string
  name: string
  processName: string
  title: string
  titlePattern: string
  displayDeviceName: string
  displayIndex: number
  bounds: NormalizedBounds
  maximized?: boolean
}
export type WorkspaceLayout = {
  version: 1
  capturedAt: string
  displays: DisplaySnapshot[]
  windows: CapturedLayoutWindow[]
}

export type NamedWorkspaceLayout = {
  id: string
  name: string
  modeId?: string
  layout: WorkspaceLayout
}

export type WorkspaceMode = {
  id: string
  name: string
  description?: string
  commandIds?: string[]
  urlIds?: string[]
  appIds?: string[]
  layoutId?: string
}

export type LayoutCaptureResult = {
  captured: number
  layout: WorkspaceLayout
  unmatched: string[]
}

export type LayoutWindowTarget = {
  id: string
  target: CapturedLayoutWindow['target']
  targetId?: string
  name: string
  suggestedHandle?: string
}

export type LayoutWindowCandidate = {
  handle: string
  pid: number
  processName: string
  executable?: string
  title: string
  displayIndex: number
}

export type OpenWorkspaceCapture = {
  name: string
  windowHandles: string[]
  createDesktopShortcut?: boolean
}

export type LayoutCapturePreview = {
  targets: LayoutWindowTarget[]
  windows: LayoutWindowCandidate[]
}

export type LayoutWindowSelection = {
  targetId: string
  windowHandle: string
}

export type LayoutCaptureOptions = {
  id: string
  name: string
  modeId?: string
  makeDefault?: boolean
}

export type LayoutRestoreResult = {
  restored: number
  missing: string[]
}

export type Workspace = {
  id: string
  name: string
  projectPath: string
  framework?: string
  editor?: { command: string; args?: string[] }
  browser?: string
  commands: WorkspaceCommand[]
  urls: WorkspaceURL[]
  apps: WorkspaceApp[]
  browserGroups?: WorkspaceBrowserGroup[]
  modes?: WorkspaceMode[]
  layout?: WorkspaceLayout
  layouts?: NamedWorkspaceLayout[]
  defaultLayoutId?: string
  createdAt: string
  updatedAt: string
  lastLaunchedAt?: string
  lastReadyTimeMs?: number
}

export type LaunchEvent = {
  workspaceId: string
  step: string
  state: LaunchStepState
  message: string
  timestamp: string
  code?: 'already-running' | 'port-conflict' | 'health-timeout'
  details?: Record<string, string | number | boolean | undefined>
}

export type ProcessInfo = {
  commandId: string
  workspaceId: string
  name: string
  pid?: number
  state: CommandState
  logs: string[]
  instanceId?: string
  startedAt?: number
  readyAt?: number
  exitCode?: number | null
}

export type RuntimeWorkspace = {
  workspaceId: string
  status: RuntimeWorkspaceStatus
  processes: ProcessInfo[]
  startedAt?: number
  readyAt?: number
}

export type PortConflict = {
  port: number
  host: string
  pid?: number
  processName?: string
  ownedByWorkspaceId?: string
  ownedByCommandId?: string
  url?: string
}

export type LaunchResult = {
  status: 'launched' | 'already-running' | 'port-conflict' | 'failed'
  workspaceId: string
  readyTimeMs?: number
  conflict?: PortConflict
  modeId?: string
}

export type ProjectDetection = {
  name: string
  framework: string
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  scripts: string[]
  suggestedCommand: string
  suggestedUrl: string
}

export type Preferences = {
  launchAtLogin: boolean
  startHidden: boolean
  minimizeToTray: boolean
  defaultBrowser: 'Chrome' | 'Edge' | 'System'
  globalLauncher: boolean
  notifications: boolean
}

export type DevLaunchAPI = {
  listWorkspaces(): Promise<Workspace[]>
  saveWorkspace(workspace: Workspace): Promise<Workspace[]>
  deleteWorkspace(id: string): Promise<Workspace[]>
  createDesktopShortcut(id: string): Promise<{ path: string }>
  chooseFolder(): Promise<string | null>
  chooseExecutable(): Promise<string | null>
  detectProject(path: string): Promise<ProjectDetection>
  launchWorkspace(id: string, behavior?: 'normal' | 'another' | 'use-existing', modeId?: string): Promise<LaunchResult>
  focusWorkspace(id: string): Promise<{ focused: number }>
  restartWorkspace(id: string, modeId?: string): Promise<LaunchResult>
  stopWorkspace(id: string): Promise<void>
  restartProcess(workspaceId: string, commandId: string): Promise<void>
  getProcesses(id?: string): Promise<ProcessInfo[]>
  getRuntime(id: string): Promise<RuntimeWorkspace>
  previewCurrentLayout(id: string): Promise<LayoutCapturePreview>
  previewOpenWindows(): Promise<LayoutWindowCandidate[]>
  createWorkspaceFromOpenWindows(capture: OpenWorkspaceCapture): Promise<{ workspaces: Workspace[]; workspace: Workspace; shortcutCreated: boolean }>
  captureCurrentLayout(id: string, selections?: LayoutWindowSelection[], options?: LayoutCaptureOptions): Promise<LayoutCaptureResult>
  restoreLayout(id: string, layoutId?: string): Promise<LayoutRestoreResult>
  openExternal(url: string, browser?: string): Promise<void>
  getPreferences(): Promise<Preferences>
  savePreferences(preferences: Preferences): Promise<Preferences>
  onLaunchEvent(callback: (event: LaunchEvent) => void): () => void
  onProcessUpdate(callback: (process: ProcessInfo) => void): () => void
  onTrayLaunch(callback: (workspaceId: string) => void): () => void
  onOpenLauncher(callback: () => void): () => void
}
