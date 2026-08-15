import { BrowserWindow, Notification, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { HealthCheck, LaunchEvent, LaunchResult, LayoutCaptureOptions, LayoutWindowSelection, PortConflict, RuntimeWorkspace, Workspace, WorkspaceCommand, WorkspaceURL } from '../../shared/types'
import { resolveWorkspaceLayout, resolveWorkspaceMode, workspaceLayouts } from '../../shared/workspaceModes'
import { focusWorkspaceWindows } from '../platform/windows/focusWorkspace'
import { captureWorkspaceLayout, previewWorkspaceLayout, restoreWorkspaceLayout } from '../platform/windows/windowPosition'
import { checkHttp, inspectPort, isPortOpen, targetFromUrl } from './portManager'
import { preferencesStore, workspaceStore } from './store'
import { ProcessManager } from './processManager'
import { planCommands } from './dependencyPlanner'
import { planBrowserLaunches } from './browserPlanner'

const canAccess = (path: string) => access(path).then(() => true).catch(() => false)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const spawnDetached = (executable: string, args: string[], shell = false) => new Promise<ChildProcess>((resolve, reject) => {
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', shell })
  child.once('spawn', () => resolve(child))
  child.once('error', reject)
})
const chromeCandidates = [
  process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe') : '',
  process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)']!, 'Google/Chrome/Application/chrome.exe') : '',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : ''
].filter(Boolean)
const edgeCandidates = [
  process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe') : '',
  process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)']!, 'Microsoft/Edge/Application/msedge.exe') : '',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : ''
].filter(Boolean)

async function resolveBrowser(browser: string) {
  const candidates = browser.toLowerCase() === 'edge' ? edgeCandidates : chromeCandidates
  for (const candidate of candidates) if (await canAccess(candidate)) return candidate
  return null
}

function commandHealthCheck(command: WorkspaceCommand): HealthCheck {
  if (command.healthCheck) return command.healthCheck
  if (command.waitForUrl) return { type: 'http', target: command.waitForUrl, timeout: 30_000, interval: 500 }
  return { type: 'process', target: command.command }
}

export class WorkspaceLauncher {
  private runtimes = new Map<string, RuntimeWorkspace>()
  private externalPids = new Map<string, Set<number>>()

  constructor(private processes: ProcessManager) {}

  private emit(workspaceId: string, step: string, state: LaunchEvent['state'], message: string, extra: Partial<LaunchEvent> = {}) {
    const event: LaunchEvent = { workspaceId, step, state, message, timestamp: new Date().toISOString(), ...extra }
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('launch:event', event))
  }

  private setRuntime(workspaceId: string, patch: Partial<RuntimeWorkspace>) {
    const current = this.getRuntime(workspaceId)
    this.runtimes.set(workspaceId, { ...current, ...patch, processes: this.processes.get(workspaceId) })
  }

  getRuntime(workspaceId: string): RuntimeWorkspace {
    const current = this.runtimes.get(workspaceId)
    return current
      ? { ...current, processes: this.processes.get(workspaceId) }
      : { workspaceId, status: this.processes.isRunning(workspaceId) ? 'running' : 'stopped', processes: this.processes.get(workspaceId) }
  }

  private trackExternalPid(workspaceId: string, pid?: number) {
    if (!pid) return
    const current = this.externalPids.get(workspaceId) || new Set<number>()
    current.add(pid)
    this.externalPids.set(workspaceId, current)
  }

  async openUrl(url: string, browser = 'Chrome', workspaceId?: string) {
    return this.openUrlGroup([url], browser, undefined, workspaceId)
  }

  private async openUrlGroup(urls: string[], browser = 'Chrome', profile?: string, workspaceId?: string) {
    if (['chrome', 'edge'].includes(browser.toLowerCase()) && process.platform === 'win32') {
      const executable = await resolveBrowser(browser)
      if (executable) {
        const args = [...(profile ? [`--profile-directory=${profile}`] : []), '--new-window', ...urls]
        const child = await spawnDetached(executable, args)
        this.trackExternalPid(workspaceId || '', child.pid)
        child.unref()
        return
      }
    }
    for (const url of urls) await shell.openExternal(url)
  }

  async launch(id: string, behavior: 'normal' | 'another' | 'use-existing' = 'normal', modeId?: string): Promise<LaunchResult> {
    return this.launchInternal(id, behavior, { openTools: true, modeId })
  }

  private async launchInternal(id: string, behavior: 'normal' | 'another' | 'use-existing', options: { openTools: boolean; modeId?: string }): Promise<LaunchResult> {
    const workspace = workspaceStore.get(id)
    if (!workspace) throw new Error('Workspace not found')
    const mode = resolveWorkspaceMode(workspace, options.modeId)
    const selectedCommandIds = new Set(mode.commandIds || workspace.commands.filter((item) => item.runOnLaunch).map((item) => item.id))
    let commands: WorkspaceCommand[]
    try { commands = planCommands(workspace.commands, selectedCommandIds) }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid command dependencies'
      this.emit(id, 'dependencies', 'failed', message)
      return { status: 'failed', workspaceId: id, modeId: mode.id }
    }
    const urls = workspace.urls.filter((item) => item.openOnLaunch && (!mode.urlIds || mode.urlIds.includes(item.id)))
    const apps = workspace.apps.filter((item) => item.openOnLaunch && (!mode.appIds || mode.appIds.includes(item.id)))
    if (behavior === 'normal' && (this.processes.isRunning(id) || ['launching', 'running', 'degraded'].includes(this.getRuntime(id).status))) {
      this.emit(id, 'already-running', 'failed', `${workspace.name} is already running`, { code: 'already-running' })
      return { status: 'already-running', workspaceId: id, modeId: mode.id }
    }

    const instanceId = behavior === 'another' ? this.processes.createInstanceId() : 'primary'
    const useExisting = new Set<string>()
    for (const command of commands) {
      const health = commandHealthCheck(command)
      if (health.type !== 'http') continue
      const conflict = await inspectPort(health.target)
      if (!conflict) continue
      const owned = this.findPortOwnership(conflict)
      Object.assign(conflict, owned)
      if (behavior === 'use-existing' && await checkHttp(health.target)) {
        useExisting.add(command.id)
        continue
      }
      this.emit(id, `port:${conflict.port}`, 'failed', `Port ${conflict.port} is already in use${conflict.processName ? ` by ${conflict.processName}` : ''}`, {
        code: 'port-conflict', details: { port: conflict.port, pid: conflict.pid, processName: conflict.processName, ownedByWorkspaceId: conflict.ownedByWorkspaceId }
      })
      return { status: 'port-conflict', workspaceId: id, conflict, modeId: mode.id }
    }

    const startedAt = Date.now()
    this.setRuntime(id, { status: 'launching', startedAt, readyAt: undefined })
    this.emit(id, 'workspace', 'active', `Launching ${workspace.name} · ${mode.name}…`)
    if (options.openTools) await this.launchEditor(workspace)
    let degraded = false

    const commandHealth = new Map<string, boolean>()
    for (const command of commands) {
      const failedDependency = (command.dependsOn || []).find((dependency) => commandHealth.get(dependency) === false)
      if (failedDependency) {
        degraded = true; commandHealth.set(command.id, false)
        this.emit(id, `command:${command.id}`, 'skipped', `${command.name} skipped because a dependency did not become ready`)
        continue
      }
      if (useExisting.has(command.id)) {
        commandHealth.set(command.id, true)
        this.emit(id, `command:${command.id}`, 'skipped', `${command.name}: using existing healthy service`)
        continue
      }
      try {
        const info = this.processes.start(id, command, workspace.projectPath, instanceId)
        this.emit(id, `command:${command.id}`, 'complete', `${command.name} started${info.pid ? ` · PID ${info.pid}` : ''}`)
        const healthy = await this.waitForHealth(id, command, instanceId)
        commandHealth.set(command.id, healthy)
        if (!healthy) degraded = true
      } catch (error) {
        commandHealth.set(command.id, false)
        degraded = true
        this.emit(id, `command:${command.id}`, 'failed', error instanceof Error ? error.message : 'Command failed')
      }
    }

    if (options.openTools) {
      for (const url of urls) {
        try {
          if (url.waitForReady && !commands.some((command) => command.waitForUrl === url.url || command.healthCheck?.target === url.url)) await this.waitForUrl(id, url.url)
        } catch {
          degraded = true
          this.emit(id, `url:${url.id}`, 'failed', `${url.name} did not become ready`)
        }
      }

      const browserLaunches = planBrowserLaunches({ ...workspace, browser: workspace.browser || preferencesStore.get().defaultBrowser }, urls)
      for (const launch of browserLaunches) try {
        await this.openUrlGroup(launch.urls.map((item) => item.url), launch.browser, launch.profile, id)
        launch.urls.forEach((url) => this.emit(id, `url:${url.id}`, 'complete', `${url.name} opened${launch.name ? ` in ${launch.name}` : ''}`))
      } catch {
        degraded = true
        launch.urls.forEach((url) => this.emit(id, `url:${url.id}`, 'failed', `${url.name} could not be opened`))
      }

      for (const externalApp of apps) {
        try {
          const child = await spawnDetached(externalApp.executable, externalApp.args || [])
          this.trackExternalPid(id, child.pid)
          child.unref()
          this.emit(id, `app:${externalApp.id}`, 'complete', `${externalApp.name} opened`)
        } catch {
          degraded = true
          this.emit(id, `app:${externalApp.id}`, 'failed', `${externalApp.name} could not be opened`)
        }
      }
    }

    const namedLayout = resolveWorkspaceLayout(workspace, mode.id)
    if (options.openTools && namedLayout?.layout.windows.length) {
      const layoutResult = await this.restoreLayoutWithWait(namedLayout.layout)
      if (layoutResult.restored) this.emit(id, 'layout', 'complete', `Restored ${layoutResult.restored} window${layoutResult.restored === 1 ? '' : 's'}`)
      if (layoutResult.missing.length) {
        degraded = true
        this.emit(id, 'layout', 'failed', `Could not find ${layoutResult.missing.join(', ')} for layout restore`)
      }
    }

    const readyAt = Date.now()
    const readyTimeMs = readyAt - startedAt
    this.setRuntime(id, { status: degraded ? 'degraded' : 'running', readyAt })
    workspaceStore.markLaunched(id, readyAt, readyTimeMs)
    this.emit(id, 'workspace', 'complete', `Workspace ready in ${(readyTimeMs / 1000).toFixed(1)} seconds`)
    if (preferencesStore.get().notifications && Notification.isSupported()) {
      new Notification({
        title: degraded ? `${workspace.name} is ready with warnings` : `${workspace.name} is ready`,
        body: `${mode.name} restored in ${(readyTimeMs / 1000).toFixed(1)} seconds`
      }).show()
    }
    return { status: 'launched', workspaceId: id, readyTimeMs, modeId: mode.id }
  }

  async stop(id: string) {
    this.setRuntime(id, { status: 'stopping' })
    await this.processes.stop(id)
    this.setRuntime(id, { status: 'stopped', readyAt: undefined })
    this.emit(id, 'workspace', 'complete', 'Workspace stopped')
  }

  async restart(id: string, modeId?: string) {
    await this.stop(id)
    await delay(500)
    // The normal launch path is deliberately reused so a restart is a complete
    // context restoration: commands, missing tools, URLs and the saved layout.
    return this.launchInternal(id, 'normal', { openTools: true, modeId })
  }

  async focus(id: string) {
    const workspace = workspaceStore.get(id)
    if (!workspace) throw new Error('Workspace not found')
    const pids = [...this.processes.get(id).map((item) => item.pid), ...(this.externalPids.get(id) || [])].filter((pid): pid is number => Boolean(pid))
    const result = await focusWorkspaceWindows(workspace, pids)
    this.emit(id, 'focus', result.focused ? 'complete' : 'failed', result.focused ? `Focused ${result.focused} workspace window${result.focused === 1 ? '' : 's'}` : 'No matching workspace windows were found')
    return result
  }

  async previewLayout(id: string) {
    const workspace = workspaceStore.get(id)
    if (!workspace) throw new Error('Workspace not found')
    return previewWorkspaceLayout(workspace, this.trackedPids(id))
  }

  async captureLayout(id: string, selections?: LayoutWindowSelection[], options?: LayoutCaptureOptions) {
    const workspace = workspaceStore.get(id)
    if (!workspace) throw new Error('Workspace not found')
    const result = await captureWorkspaceLayout(workspace, this.trackedPids(id), selections)
    if (!result.captured) throw new Error('No matching VS Code, browser, or application windows were found')
    const saved = options || { id: workspace.defaultLayoutId || 'default', name: 'Default', makeDefault: true }
    const layouts = workspaceLayouts(workspace)
    const named = { id: saved.id, name: saved.name, modeId: saved.modeId, layout: result.layout }
    const nextLayouts = layouts.some((item) => item.id === named.id) ? layouts.map((item) => item.id === named.id ? named : item) : [...layouts, named]
    workspaceStore.save({
      ...workspace, layout: result.layout, layouts: nextLayouts,
      defaultLayoutId: saved.makeDefault || !workspace.defaultLayoutId ? named.id : workspace.defaultLayoutId,
      modes: workspace.modes?.map((mode) => saved.modeId && mode.id === saved.modeId ? { ...mode, layoutId: named.id } : mode),
      updatedAt: new Date().toISOString()
    })
    this.emit(id, 'layout:capture', 'complete', `Captured ${result.captured} window${result.captured === 1 ? '' : 's'}`)
    return result
  }

  async restoreLayout(id: string, layoutId?: string) {
    const workspace = workspaceStore.get(id)
    if (!workspace) throw new Error('Workspace not found')
    const named = resolveWorkspaceLayout(workspace, undefined, layoutId)
    if (!named?.layout.windows.length) throw new Error('This workspace does not have a captured layout yet')
    const result = await restoreWorkspaceLayout(named.layout)
    this.emit(id, 'layout', result.restored ? 'complete' : 'failed', result.restored ? `Restored ${result.restored} window${result.restored === 1 ? '' : 's'}` : 'No saved workspace windows were found')
    return result
  }

  private trackedPids(id: string) {
    return [...this.processes.get(id).map((item) => item.pid), ...(this.externalPids.get(id) || [])].filter((pid): pid is number => Boolean(pid))
  }

  private async restoreLayoutWithWait(layout: NonNullable<Workspace['layout']>) {
    const deadline = Date.now() + 8_000
    let result = await restoreWorkspaceLayout(layout)
    while (result.missing.length && Date.now() < deadline) {
      await delay(700)
      result = await restoreWorkspaceLayout(layout)
    }
    return result
  }

  private findPortOwnership(conflict: PortConflict) {
    if (!conflict.pid) return {}
    const owned = this.processes.get().find((item) => item.pid === conflict.pid)
    return owned ? { ownedByWorkspaceId: owned.workspaceId, ownedByCommandId: owned.commandId } : {}
  }

  private async waitForHealth(workspaceId: string, command: WorkspaceCommand, instanceId: string) {
    const health = commandHealthCheck(command)
    if (health.type === 'process') {
      this.processes.setState(workspaceId, command.id, 'ready', instanceId)
      return true
    }
    const timeout = Math.min(Math.max(health.timeout || 30_000, 1000), 120_000)
    const interval = Math.min(Math.max(health.interval || 500, 200), 5000)
    this.processes.setState(workspaceId, command.id, 'waiting', instanceId)
    this.processes.appendLog(workspaceId, command.id, `Health check: waiting for ${health.target}`, instanceId)
    this.emit(workspaceId, `health:${command.id}`, 'active', `Waiting for ${command.name}…`)
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const healthy = health.type === 'http'
        ? await checkHttp(health.target)
        : await this.checkTcpTarget(health.target)
      if (healthy) {
        this.processes.setState(workspaceId, command.id, 'ready', instanceId)
        this.processes.appendLog(workspaceId, command.id, 'Health check passed', instanceId)
        this.emit(workspaceId, `health:${command.id}`, 'complete', `${command.name} ready`)
        return true
      }
      await delay(interval)
    }
    this.processes.setState(workspaceId, command.id, 'degraded', instanceId)
    this.processes.appendLog(workspaceId, command.id, `Health check timed out after ${Math.round(timeout / 1000)}s`, instanceId)
    this.emit(workspaceId, `health:${command.id}`, 'failed', `${command.name} did not become ready after ${Math.round(timeout / 1000)} seconds`, { code: 'health-timeout' })
    return false
  }

  private async checkTcpTarget(target: string) {
    try {
      const parsed = target.includes('://') ? targetFromUrl(target) : (() => { const [host, port] = target.split(':'); return { host, port: Number(port) } })()
      return Boolean(parsed.host && parsed.port && await isPortOpen(parsed.host, parsed.port))
    } catch { return false }
  }

  private async launchEditor(workspace: Workspace) {
    if (!workspace.editor?.command) return
    try {
      const args = [...(workspace.editor.args || []), workspace.projectPath]
      const child = await spawnDetached(workspace.editor.command, args, process.platform === 'win32')
      this.trackExternalPid(workspace.id, child.pid)
      child.unref()
      this.emit(workspace.id, 'editor', 'complete', 'VS Code opened')
    } catch { this.emit(workspace.id, 'editor', 'failed', 'VS Code could not be opened') }
  }

  private async waitForUrl(workspaceId: string, url: string, timeout = 30_000) {
    this.emit(workspaceId, `wait:${url}`, 'active', `Waiting for ${new URL(url).host}…`)
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await checkHttp(url)) { this.emit(workspaceId, `wait:${url}`, 'complete', `${new URL(url).host} ready`); return true }
      await delay(500)
    }
    this.emit(workspaceId, `wait:${url}`, 'failed', `${new URL(url).host} did not respond after 30 seconds`, { code: 'health-timeout' })
    return false
  }
}
