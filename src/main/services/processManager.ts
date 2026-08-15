import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { CommandState, ProcessInfo, WorkspaceCommand } from '../../shared/types'

type Tracked = ProcessInfo & { child: ChildProcessWithoutNullStreams; command: WorkspaceCommand; cwd: string }

export class ProcessManager extends EventEmitter {
  private tracked = new Map<string, Tracked>()
  private key(workspaceId: string, commandId: string, instanceId: string) { return `${workspaceId}:${commandId}:${instanceId}` }

  start(workspaceId: string, command: WorkspaceCommand, projectPath: string, instanceId = 'primary') {
    const key = this.key(workspaceId, command.id, instanceId)
    const existing = this.tracked.get(key)
    if (existing && ['starting', 'waiting', 'ready', 'running'].includes(existing.state)) return this.public(existing)

    const cwd = command.cwd || projectPath
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', command.command], { cwd, windowsHide: true })
      : spawn('/bin/sh', ['-lc', command.command], { cwd, detached: true })
    const tracked: Tracked = {
      workspaceId, commandId: command.id, instanceId, name: command.name, pid: child.pid,
      state: 'starting', logs: [], child, command, cwd, startedAt: Date.now()
    }
    this.tracked.set(key, tracked)
    this.update(tracked)

    const push = (chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean)
      tracked.logs.push(...lines)
      tracked.logs = tracked.logs.slice(-500)
      if (tracked.state === 'starting') tracked.state = 'running'
      this.update(tracked)
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    child.once('spawn', () => { tracked.state = 'running'; this.update(tracked) })
    child.once('error', (error) => { tracked.state = 'failed'; tracked.logs.push(error.message); this.update(tracked) })
    child.once('exit', (code) => {
      tracked.exitCode = code
      tracked.state = code === 0 ? 'stopped' : 'failed'
      tracked.logs.push(`Process exited with code ${code ?? 'unknown'}`)
      this.update(tracked)
    })
    return this.public(tracked)
  }

  setState(workspaceId: string, commandId: string, state: CommandState, instanceId = 'primary') {
    const tracked = this.tracked.get(this.key(workspaceId, commandId, instanceId))
    if (!tracked) return
    tracked.state = state
    if (state === 'ready') tracked.readyAt = Date.now()
    this.update(tracked)
  }

  appendLog(workspaceId: string, commandId: string, message: string, instanceId = 'primary') {
    const tracked = this.tracked.get(this.key(workspaceId, commandId, instanceId))
    if (!tracked) return
    tracked.logs.push(message)
    tracked.logs = tracked.logs.slice(-500)
    this.update(tracked)
  }

  async stop(workspaceId: string, commandId?: string) {
    const targets = [...this.tracked.values()].filter((item) => item.workspaceId === workspaceId && (!commandId || item.commandId === commandId))
    await Promise.all(targets.map((item) => new Promise<void>((resolve) => {
      if (!item.pid || item.state === 'stopped') return resolve()
      const finish = () => { item.state = 'stopped'; this.update(item); resolve() }
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(item.pid), '/T', '/F'], { windowsHide: true })
        killer.once('exit', finish)
        killer.once('error', () => { item.child.kill(); finish() })
      } else {
        try { process.kill(-item.pid, 'SIGTERM') } catch { item.child.kill('SIGTERM') }
        finish()
      }
    })))
  }

  isRunning(workspaceId: string) {
    return [...this.tracked.values()].some((item) => item.workspaceId === workspaceId && ['starting', 'waiting', 'ready', 'running', 'degraded'].includes(item.state))
  }

  get(workspaceId?: string) {
    return [...this.tracked.values()].filter((item) => !workspaceId || item.workspaceId === workspaceId).map((item) => this.public(item))
  }

  getCommand(workspaceId: string, commandId: string) {
    return [...this.tracked.values()].find((item) => item.workspaceId === workspaceId && item.commandId === commandId)
  }

  createInstanceId() { return randomUUID() }
  private public(item: Tracked): ProcessInfo { const { child: _, command: __, cwd: ___, ...info } = item; return { ...info, logs: [...info.logs] } }
  private update(item: Tracked) { this.emit('update', this.public(item)) }
}
