import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import type { PortConflict } from '../../shared/types'

const execFileAsync = promisify(execFile)

export function targetFromUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  return { host: url.hostname || 'localhost', port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), url: rawUrl }
}

export function isPortOpen(host: string, port: number, timeout = 600) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port })
    const done = (open: boolean) => { socket.destroy(); resolve(open) }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function getWindowsPortOwner(port: number) {
  const command = `$c=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue|Select-Object -First 1;if($c){$p=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue;[PSCustomObject]@{pid=$c.OwningProcess;processName=$p.ProcessName}|ConvertTo-Json -Compress}`
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 2500 })
    return stdout.trim() ? JSON.parse(stdout.trim()) as { pid?: number; processName?: string } : {}
  } catch { return {} }
}

export async function inspectPort(rawUrl: string): Promise<PortConflict | null> {
  const target = targetFromUrl(rawUrl)
  if (!await isPortOpen(target.host, target.port)) return null
  const owner = process.platform === 'win32' ? await getWindowsPortOwner(target.port) : {}
  return { ...target, ...owner }
}

export async function checkHttp(rawUrl: string, timeout = 1500) {
  try {
    const response = await fetch(rawUrl, { signal: AbortSignal.timeout(timeout) })
    return response.status < 500
  } catch { return false }
}
