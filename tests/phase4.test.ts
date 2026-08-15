import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { detectProject } from '../src/main/services/projectDetector'
import { workspaceModes } from '../src/shared/workspaceModes'
import type { Workspace } from '../src/shared/types'

test('detects a typed Vite React project and pnpm launch command', async () => {
  const path = join(tmpdir(), `devlaunch-vite-${Date.now()}`)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'trailer-park', scripts: { dev: 'vite' }, dependencies: { react: '^18', vite: '^5' } }))
  await writeFile(join(path, 'pnpm-lock.yaml'), '')
  await writeFile(join(path, 'tsconfig.json'), '{}')
  const result = await detectProject(path)
  assert.equal(result.framework, 'React · Vite · TypeScript')
  assert.equal(result.suggestedCommand, 'pnpm dev')
  assert.equal(result.suggestedUrl, 'http://localhost:5173')
})

test('everyday captured workspaces keep all apps in the full launch mode', () => {
  const workspace: Workspace = { id: 'daily', name: 'Morning', projectPath: 'C:\\Users\\Dave', framework: 'Captured workspace', commands: [], urls: [], apps: [{ id: 'mail', name: 'Mail', executable: 'mail.exe', openOnLaunch: true }], createdAt: '', updatedAt: '' }
  const full = workspaceModes(workspace).find((mode) => mode.id === 'full')!
  assert.equal(full.appIds, undefined)
})
