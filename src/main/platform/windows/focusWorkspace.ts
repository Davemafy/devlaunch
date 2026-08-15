import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import type { Workspace } from '../../../shared/types'

const execFileAsync = promisify(execFile)

export async function focusWorkspaceWindows(workspace: Workspace, pids: number[]) {
  if (process.platform !== 'win32') return { focused: 0 }
  const tokens = [workspace.name, basename(workspace.projectPath), ...workspace.urls.map((item) => {
    try { return new URL(item.url).host } catch { return '' }
  })].filter((item) => item.length > 2)
  const payload = Buffer.from(JSON.stringify({ tokens, pids }), 'utf8').toString('base64')
  const script = `
$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DevLaunchWindowFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$count=0
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $process=$_
  $title=$process.MainWindowTitle
  $pidMatch=$data.pids -contains $process.Id
  $titleMatch=$false
  foreach($token in $data.tokens){ if($title -and $title.IndexOf($token,[StringComparison]::OrdinalIgnoreCase) -ge 0){$titleMatch=$true;break} }
  if($pidMatch -or $titleMatch){
    [DevLaunchWindowFocus]::ShowWindowAsync($process.MainWindowHandle,9)|Out-Null
    [DevLaunchWindowFocus]::SetForegroundWindow($process.MainWindowHandle)|Out-Null
    $count++
  }
}
Write-Output $count`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 5000 })
    return { focused: Number.parseInt(stdout.trim(), 10) || 0 }
  } catch { return { focused: 0 } }
}
