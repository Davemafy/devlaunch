import { basename, extname } from 'node:path'
import type {
  CapturedLayoutWindow, DisplaySnapshot, LayoutCapturePreview, LayoutCaptureResult, LayoutRestoreResult,
  LayoutWindowSelection, LayoutWindowTarget, NormalizedBounds, Workspace, WorkspaceLayout
} from '../../../shared/types'
import { runWindowsPowerShell, user32WindowTypes } from './windows'

export type NativeWindow = {
  handle: string
  pid: number
  processName: string
  executable?: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  minimized: boolean
  maximized: boolean
}

type WindowSnapshot = { displays: DisplaySnapshot[]; windows: NativeWindow[] }
type Target = {
  id: string
  target: CapturedLayoutWindow['target']
  targetId?: string
  name: string
  processNames: string[]
  titleTokens: string[]
}

const clean = (value: string) => value.trim().toLowerCase()
const executableName = (value: string) => basename(value, extname(value)).toLowerCase()
const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value))

export function normalizeBounds(bounds: NativeWindow['bounds'], display: DisplaySnapshot): NormalizedBounds {
  const area = display.workingArea
  return {
    x: clamp((bounds.x - area.x) / area.width, -0.25, 1.25),
    y: clamp((bounds.y - area.y) / area.height, -0.25, 1.25),
    width: clamp(bounds.width / area.width, 0.05, 1.5),
    height: clamp(bounds.height / area.height, 0.05, 1.5)
  }
}

export function denormalizeBounds(bounds: NormalizedBounds, display: DisplaySnapshot) {
  const area = display.workingArea
  return {
    x: Math.round(area.x + bounds.x * area.width),
    y: Math.round(area.y + bounds.y * area.height),
    width: Math.max(200, Math.round(bounds.width * area.width)),
    height: Math.max(120, Math.round(bounds.height * area.height))
  }
}

function displayForWindow(window: NativeWindow, displays: DisplaySnapshot[]) {
  const centerX = window.bounds.x + window.bounds.width / 2
  const centerY = window.bounds.y + window.bounds.height / 2
  return displays.find((display) => centerX >= display.bounds.x && centerX < display.bounds.x + display.bounds.width && centerY >= display.bounds.y && centerY < display.bounds.y + display.bounds.height)
    || displays.find((display) => display.primary)
    || displays[0]
}

function targetDefinitions(workspace: Workspace): Target[] {
  const projectName = basename(workspace.projectPath)
  const editorProcess = workspace.editor?.command ? executableName(workspace.editor.command) : 'code'
  const targets: Target[] = workspace.editor ? [{
    id: 'editor', target: 'editor', name: 'VS Code', processNames: [editorProcess, 'code'], titleTokens: [projectName, workspace.name, 'visual studio code']
  }] : []

  const grouped = new Set<string>()
  for (const url of workspace.urls.filter((item) => item.openOnLaunch)) {
    if (url.groupId) {
      if (grouped.has(url.groupId)) continue
      grouped.add(url.groupId)
      const group = workspace.browserGroups?.find((item) => item.id === url.groupId)
      const members = workspace.urls.filter((item) => item.openOnLaunch && item.groupId === url.groupId)
      const tokens = members.flatMap((item) => {
        try { return [item.name, new URL(item.url).hostname] } catch { return [item.name] }
      })
      targets.push({
        id: `browser-group:${url.groupId}`, target: 'browser-group', targetId: url.groupId,
        name: group?.name || `Browser group`, processNames: [executableName(group?.browser || url.browser || workspace.browser || 'chrome')],
        titleTokens: tokens
      })
      continue
    }
    let host = ''
    try { host = new URL(url.url).hostname } catch { /* validated before persistence */ }
    const local = ['localhost', '127.0.0.1', '::1'].includes(host)
    targets.push({
      id: `url:${url.id}`, target: 'url', targetId: url.id, name: url.name,
      processNames: [executableName(url.browser || workspace.browser || 'chrome')],
      titleTokens: [url.name, host, ...(local ? [workspace.name, projectName] : []), ...(host.includes('figma') ? ['figma'] : [])]
    })
  }
  for (const app of workspace.apps.filter((item) => item.openOnLaunch)) targets.push({
    id: `app:${app.id}`, target: 'app', targetId: app.id, name: app.name,
    processNames: [executableName(app.executable)], titleTokens: [app.name]
  })
  return targets
}

export async function previewWorkspaceLayout(workspace: Workspace, trackedPids: number[] = []): Promise<LayoutCapturePreview> {
  const snapshot = await enumerateWindows()
  const targets = targetDefinitions(workspace)
  const automatic = matchTargets(workspace, snapshot, trackedPids)
  const configuredProcesses = new Set(targets.flatMap((target) => target.processNames.map(clean)))
  const relevant = snapshot.windows.filter((window) => {
    if (clean(window.processName) === 'devlaunch') return false
    return trackedPids.includes(window.pid)
      || configuredProcesses.has(clean(window.processName))
      || targets.some((target) => scoreWindow(target, window, trackedPids) >= 0)
  })
  return {
    targets: targets.map((target): LayoutWindowTarget => ({
      id: target.id, target: target.target, targetId: target.targetId, name: target.name,
      suggestedHandle: automatic.find((item) => item.target.id === target.id)?.window?.handle
    })),
    windows: relevant.map((window) => ({
      handle: window.handle, pid: window.pid, processName: window.processName, executable: window.executable, title: window.title,
      displayIndex: displayForWindow(window, snapshot.displays)?.index || 0
    }))
  }
}

function scoreWindow(target: Target, window: NativeWindow, trackedPids: number[]) {
  const title = clean(window.title)
  const processName = clean(window.processName)
  const processMatch = target.processNames.some((item) => processName === clean(item))
  const titleMatches = target.titleTokens.filter((token) => clean(token).length > 2 && title.includes(clean(token))).length
  const pidMatch = trackedPids.includes(window.pid)
  // Process name alone is never enough: moving an unrelated Chrome or Code
  // window would be worse than reporting that a configured window was missing.
  if (!pidMatch && !titleMatches) return -1
  return (pidMatch ? 12 : 0) + titleMatches * 7 + (processMatch ? 3 : 0) + Math.min(window.bounds.width * window.bounds.height / 1_000_000, 2)
}

export function matchTargets(workspace: Workspace, snapshot: WindowSnapshot, trackedPids: number[] = []) {
  const available = [...snapshot.windows]
  return targetDefinitions(workspace).map((target) => {
    const ranked = available.map((window) => ({ window, score: scoreWindow(target, window, trackedPids) })).filter((item) => item.score >= 3).sort((a, b) => b.score - a.score)
    const match = ranked[0]?.window
    if (match) available.splice(available.indexOf(match), 1)
    return { target, window: match }
  })
}

export function matchSelectedTargets(workspace: Workspace, snapshot: WindowSnapshot, selections: LayoutWindowSelection[]) {
  const selectedHandles = selections.map((selection) => selection.windowHandle)
  if (new Set(selectedHandles).size !== selectedHandles.length) throw new Error('Each workspace item must use a different window')
  return targetDefinitions(workspace).map((target) => {
    const handle = selections.find((selection) => selection.targetId === target.id)?.windowHandle
    return { target, window: handle ? snapshot.windows.find((window) => window.handle === handle) : undefined }
  })
}

export async function enumerateWindows(): Promise<WindowSnapshot> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
${user32WindowTypes}
'@
$displays=@()
$index=0
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $displays += [pscustomobject]@{ deviceName=$_.DeviceName; index=$index; primary=$_.Primary; bounds=@{x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height}; workingArea=@{x=$_.WorkingArea.X;y=$_.WorkingArea.Y;width=$_.WorkingArea.Width;height=$_.WorkingArea.Height} }
  $index++
}
$windows=New-Object System.Collections.Generic.List[object]
$callback=[DevLaunchWindows+EnumWindowsProc]{ param($handle,$state)
  if(-not [DevLaunchWindows]::IsWindowVisible($handle)){ return $true }
  $length=[DevLaunchWindows]::GetWindowTextLength($handle)
  if($length -le 0){ return $true }
  $title=[System.Text.StringBuilder]::new($length+1)
  [DevLaunchWindows]::GetWindowText($handle,$title,$title.Capacity)|Out-Null
  $pidValue=[uint32]0
  [DevLaunchWindows]::GetWindowThreadProcessId($handle,[ref]$pidValue)|Out-Null
  $rect=New-Object DevLaunchWindows+RECT
  if(-not [DevLaunchWindows]::GetWindowRect($handle,[ref]$rect)){ return $true }
  if(($rect.Right-$rect.Left) -lt 100 -or ($rect.Bottom-$rect.Top) -lt 80){ return $true }
  try { $processObject=Get-Process -Id $pidValue -ErrorAction Stop; $process=$processObject.ProcessName; $executable=$processObject.Path } catch { $process=''; $executable='' }
  $windows.Add([pscustomobject]@{ handle=$handle.ToInt64().ToString(); pid=[int]$pidValue; processName=$process; executable=$executable; title=$title.ToString(); bounds=@{x=$rect.Left;y=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)}; minimized=[DevLaunchWindows]::IsIconic($handle); maximized=[DevLaunchWindows]::IsZoomed($handle) })
  return $true
}

[DevLaunchWindows]::EnumWindows($callback,[IntPtr]::Zero)|Out-Null
@{displays=$displays;windows=$windows}|ConvertTo-Json -Depth 6 -Compress`
  return runWindowsPowerShell<WindowSnapshot>(script)
}

export async function previewOpenWindows() {
  const snapshot = await enumerateWindows()
  return snapshot.windows.filter((window) => clean(window.processName) !== 'devlaunch' && Boolean(window.executable)).map((window) => ({
    handle: window.handle, pid: window.pid, processName: window.processName,
    executable: window.executable, title: window.title,
    displayIndex: displayForWindow(window, snapshot.displays)?.index || 0
  }))
}

export async function captureSelectedOpenWindows(selections: { handle: string; id: string; name: string }[]) {
  const snapshot = await enumerateWindows()
  const windows: CapturedLayoutWindow[] = selections.flatMap((selection) => {
    const window = snapshot.windows.find((item) => item.handle === selection.handle)
    if (!window) return []
    const display = displayForWindow(window, snapshot.displays)
    if (!display) return []
    return [{
      id: `app:${selection.id}:${selection.handle}`, target: 'app', targetId: selection.id, name: selection.name,
      processName: window.processName, title: window.title, titlePattern: window.title.slice(0, 160),
      displayDeviceName: display.deviceName, displayIndex: display.index,
      bounds: normalizeBounds(window.bounds, display), maximized: window.maximized
    }]
  })
  return { version: 1 as const, capturedAt: new Date().toISOString(), displays: snapshot.displays, windows }
}

export async function captureWorkspaceLayout(workspace: Workspace, trackedPids: number[] = [], selections?: LayoutWindowSelection[]): Promise<LayoutCaptureResult> {
  const snapshot = await enumerateWindows()
  const matched = selections ? matchSelectedTargets(workspace, snapshot, selections) : matchTargets(workspace, snapshot, trackedPids)
  const windows: CapturedLayoutWindow[] = matched.flatMap(({ target, window }) => {
    if (!window) return []
    const display = displayForWindow(window, snapshot.displays)
    if (!display) return []
    return [{
      id: target.id, target: target.target, targetId: target.targetId, name: target.name,
      processName: window.processName, title: window.title, titlePattern: window.title.slice(0, 160),
      displayDeviceName: display.deviceName, displayIndex: display.index,
      bounds: normalizeBounds(window.bounds, display), maximized: window.maximized
    }]
  })
  const layout: WorkspaceLayout = { version: 1, capturedAt: new Date().toISOString(), displays: snapshot.displays, windows }
  return { captured: windows.length, layout, unmatched: matched.filter((item) => !item.window).map((item) => item.target.name) }
}

function restorePayload(layout: WorkspaceLayout, snapshot: WindowSnapshot) {
  const available = [...snapshot.windows]
  const primary = snapshot.displays.find((display) => display.primary) || snapshot.displays[0]
  return layout.windows.flatMap((saved) => {
    const ranked = available.map((window) => {
      const processScore = clean(window.processName) === clean(saved.processName) ? (saved.target === 'app' ? 7 : 4) : 0
      const savedTitle = clean(saved.titlePattern)
      const title = clean(window.title)
      const titleScore = savedTitle && (title.includes(savedTitle) || savedTitle.includes(title)) ? 10 : saved.target === 'editor' && title.includes('visual studio code') ? 3 : 0
      return { window, score: processScore + titleScore }
    }).filter((item) => item.score >= 7).sort((a, b) => b.score - a.score)
    const match = ranked[0]?.window
    if (!match) return []
    available.splice(available.indexOf(match), 1)
    const display = snapshot.displays.find((item) => item.deviceName === saved.displayDeviceName)
      || snapshot.displays.find((item) => item.index === saved.displayIndex)
      || primary
    if (!display) return []
    return [{ id: saved.id, handle: match.handle, bounds: denormalizeBounds(saved.bounds, display), maximized: Boolean(saved.maximized) }]
  })
}

export async function restoreWorkspaceLayout(layout: WorkspaceLayout): Promise<LayoutRestoreResult> {
  const snapshot = await enumerateWindows()
  const moves = restorePayload(layout, snapshot)
  if (!moves.length) return { restored: 0, missing: layout.windows.map((window) => window.name) }
  const payload = Buffer.from(JSON.stringify(moves), 'utf8').toString('base64')
  const script = `
$moves=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
Add-Type @'
${user32WindowTypes}
'@
$restored=0
foreach($move in $moves){
  $handle=[IntPtr]([long]$move.handle)
  [DevLaunchWindows]::ShowWindowAsync($handle,9)|Out-Null
  if([DevLaunchWindows]::SetWindowPos($handle,[IntPtr]::Zero,[int]$move.bounds.x,[int]$move.bounds.y,[int]$move.bounds.width,[int]$move.bounds.height,0x0014)){ $restored++ }
  if($move.maximized){ [DevLaunchWindows]::ShowWindowAsync($handle,3)|Out-Null }
}
@{restored=$restored}|ConvertTo-Json -Compress`
  const result = await runWindowsPowerShell<{ restored: number }>(script)
  const moved = new Set(moves.slice(0, result.restored).map((item) => item.id))
  return { restored: result.restored, missing: layout.windows.filter((item) => !moved.has(item.id)).map((item) => item.name) }
}
