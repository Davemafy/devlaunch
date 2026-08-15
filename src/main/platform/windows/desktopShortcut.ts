import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Workspace } from '../../../shared/types'

const execFileAsync = promisify(execFile)

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function safeShortcutName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100)
  if (!cleaned) return 'DevLaunch Workspace'
  return WINDOWS_RESERVED_NAMES.test(cleaned) ? `${cleaned} Workspace` : cleaned
}

function quoteArgument(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`
}

function encodePowerShellValue(value: string) {
  return Buffer.from(value, 'utf8').toString('base64')
}

async function createWithPowerShell(shortcutPath: string, target: string, args: string, description: string) {
  const decode = (value: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodePowerShellValue(value)}'))`
  const script = [
    `$shortcutPath=${decode(shortcutPath)}`,
    `$target=${decode(target)}`,
    `$arguments=${decode(args)}`,
    `$description=${decode(description)}`,
    '$shell=New-Object -ComObject WScript.Shell',
    '$shortcut=$shell.CreateShortcut($shortcutPath)',
    '$shortcut.TargetPath=$target',
    '$shortcut.Arguments=$arguments',
    '$shortcut.WorkingDirectory=[IO.Path]::GetDirectoryName($target)',
    '$shortcut.Description=$description',
    '$shortcut.IconLocation="$target,0"',
    '$shortcut.Save()',
    'if(-not (Test-Path -LiteralPath $shortcutPath)){exit 1}'
  ].join(';')

  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], { windowsHide: true })
}

export async function createWorkspaceDesktopShortcut(workspace: Workspace) {
  if (process.platform !== 'win32') throw new Error('Desktop shortcuts are currently supported on Windows only.')

  const shortcutPath = join(app.getPath('desktop'), `${safeShortcutName(workspace.name)}.lnk`)
  const launchArgument = `--launch-workspace=${workspace.id}`
  const args = app.isPackaged
    ? launchArgument
    : `${quoteArgument(app.getAppPath())} ${launchArgument}`

  const description = `Launch ${workspace.name} with DevLaunch`
  let created = false
  try {
    created = shell.writeShortcutLink(shortcutPath, existsSync(shortcutPath) ? 'replace' : 'create', {
      target: process.execPath,
      cwd: dirname(process.execPath),
      args,
      description,
      icon: process.execPath,
      iconIndex: 0
    })
  } catch { /* PowerShell fallback below */ }

  if (!created) {
    await createWithPowerShell(shortcutPath, process.execPath, args, description)
    created = existsSync(shortcutPath)
  }

  if (!created) throw new Error('Windows could not create the desktop shortcut.')
  return { path: shortcutPath }
}
