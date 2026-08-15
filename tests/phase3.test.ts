import assert from 'node:assert/strict'
import test from 'node:test'
import type { Workspace, WorkspaceCommand } from '../src/shared/types'
import { resolveWorkspaceLayout, workspaceModes } from '../src/shared/workspaceModes'
import { planCommands } from '../src/main/services/dependencyPlanner'
import { planBrowserLaunches } from '../src/main/services/browserPlanner'

const commands: WorkspaceCommand[] = [
  { id: 'frontend', name: 'Frontend', command: 'npm run dev', runOnLaunch: true, dependsOn: ['api'], order: 0 },
  { id: 'db', name: 'Database', command: 'npm run db', runOnLaunch: true, order: 2 },
  { id: 'api', name: 'API', command: 'npm run api', runOnLaunch: true, dependsOn: ['db'], order: 1 }
]

const workspace: Workspace = {
  id: 'ws', name: 'Trailer Park', projectPath: 'C:\\repo', browser: 'Chrome', commands,
  urls: [
    { id: 'local', name: 'Localhost', url: 'http://localhost:5173/watch/42', openOnLaunch: true },
    { id: 'figma', name: 'Figma', url: 'https://figma.com/design/abc?node-id=5-9', openOnLaunch: true, groupId: 'research' },
    { id: 'docs', name: 'Docs', url: 'https://docs.example.com/api/reference', openOnLaunch: true, groupId: 'research' }
  ],
  browserGroups: [{ id: 'research', name: 'Research', browser: 'Chrome', profile: 'Profile 2' }],
  apps: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
}

test('dependency planning includes transitive dependencies in readiness order', () => {
  assert.deepEqual(planCommands(commands, new Set(['frontend'])).map((item) => item.id), ['db', 'api', 'frontend'])
  assert.throws(() => planCommands([{ ...commands[0], dependsOn: ['frontend'] }]), /cycle/i)
})

test('browser groups preserve deep URLs and use one configured Chrome profile', () => {
  const launches = planBrowserLaunches(workspace, workspace.urls)
  assert.equal(launches.length, 2)
  const research = launches.find((item) => item.name === 'Research')!
  assert.equal(research.profile, 'Profile 2')
  assert.deepEqual(research.urls.map((item) => item.url), [workspace.urls[1].url, workspace.urls[2].url])
  assert.ok(launches[0].urls[0].url.endsWith('/watch/42'))
})

test('built-in modes split coding and design context without losing full mode', () => {
  const modes = workspaceModes(workspace)
  assert.deepEqual(modes.map((item) => item.id), ['full', 'code', 'design'])
  assert.deepEqual(modes.find((item) => item.id === 'code')?.urlIds, ['local'])
  assert.deepEqual(modes.find((item) => item.id === 'design')?.urlIds, ['figma', 'docs'])
})

test('named layouts resolve per mode and default safely', () => {
  const layout = { version: 1 as const, capturedAt: new Date(0).toISOString(), displays: [], windows: [] }
  const configured: Workspace = {
    ...workspace,
    modes: [{ id: 'full', name: 'Full', layoutId: 'wide' }, { id: 'code', name: 'Code', layoutId: 'code-layout' }],
    layouts: [{ id: 'wide', name: 'Wide', layout }, { id: 'code-layout', name: 'Coding', modeId: 'code', layout }],
    defaultLayoutId: 'wide'
  }
  assert.equal(resolveWorkspaceLayout(configured, 'code')?.id, 'code-layout')
  assert.equal(resolveWorkspaceLayout(configured, 'full')?.id, 'wide')
})
