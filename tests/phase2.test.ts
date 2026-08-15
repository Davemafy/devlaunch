import assert from 'node:assert/strict'
import test from 'node:test'
import type { DisplaySnapshot, Workspace } from '../src/shared/types'
import { denormalizeBounds, matchSelectedTargets, matchTargets, normalizeBounds, type NativeWindow } from '../src/main/platform/windows/windowPosition'

const displays: DisplaySnapshot[] = [
  {
    deviceName: '\\\\.\\DISPLAY1', index: 0, primary: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workingArea: { x: 0, y: 0, width: 1920, height: 1040 }
  },
  {
    deviceName: '\\\\.\\DISPLAY2', index: 1, primary: false,
    bounds: { x: -1280, y: 0, width: 1280, height: 1024 },
    workingArea: { x: -1280, y: 0, width: 1280, height: 984 }
  }
]

const workspace: Workspace = {
  id: 'workspace-1', name: 'Trailer Park', projectPath: 'C:\\Users\\David\\Documents\\trailer-park',
  framework: 'React · Vite', editor: { command: 'code' }, browser: 'Chrome', commands: [],
  urls: [
    { id: 'local', name: 'Localhost', url: 'http://localhost:5173', browser: 'Chrome', openOnLaunch: true },
    { id: 'figma', name: 'Figma', url: 'https://figma.com/design/example', browser: 'Chrome', openOnLaunch: true }
  ],
  apps: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
}

test('normalized bounds survive different monitor resolutions and negative monitor coordinates', () => {
  const original = { x: -1280, y: 0, width: 640, height: 984 }
  const normalized = normalizeBounds(original, displays[1])
  assert.deepEqual(normalized, { x: 0, y: 0, width: 0.5, height: 1 })

  const replacement: DisplaySnapshot = {
    ...displays[1], bounds: { x: -1600, y: 0, width: 1600, height: 900 },
    workingArea: { x: -1600, y: 0, width: 1600, height: 860 }
  }
  assert.deepEqual(denormalizeBounds(normalized, replacement), { x: -1600, y: 0, width: 800, height: 860 })
})

test('capture matching identifies configured windows and ignores unrelated Chrome windows', () => {
  const windows: NativeWindow[] = [
    { handle: '1', pid: 100, processName: 'Code', title: 'trailer-park — Visual Studio Code', bounds: { x: 0, y: 0, width: 1000, height: 1040 }, minimized: false },
    { handle: '2', pid: 200, processName: 'chrome', title: 'Trailer Park — Google Chrome', bounds: { x: 1000, y: 520, width: 920, height: 520 }, minimized: false },
    { handle: '3', pid: 201, processName: 'chrome', title: 'Trailer Park – Figma — Google Chrome', bounds: { x: 1000, y: 0, width: 920, height: 520 }, minimized: false },
    { handle: '4', pid: 202, processName: 'chrome', title: 'Unrelated email — Google Chrome', bounds: { x: -1280, y: 0, width: 1280, height: 984 }, minimized: false }
  ]
  const matches = matchTargets(workspace, { displays, windows })
  assert.equal(matches.find((item) => item.target.id === 'editor')?.window?.handle, '1')
  assert.equal(matches.find((item) => item.target.id === 'url:local')?.window?.handle, '2')
  assert.equal(matches.find((item) => item.target.id === 'url:figma')?.window?.handle, '3')
  assert.ok(!matches.some((item) => item.window?.handle === '4'))
})

test('explicit capture selections map browser windows even when their titles cannot be inferred', () => {
  const windows: NativeWindow[] = [
    { handle: '10', pid: 300, processName: 'Code', title: 'project', bounds: { x: 0, y: 0, width: 900, height: 900 }, minimized: false },
    { handle: '20', pid: 301, processName: 'chrome', title: 'Vite App', bounds: { x: 900, y: 450, width: 900, height: 450 }, minimized: false },
    { handle: '30', pid: 302, processName: 'chrome', title: 'Rivelo Portfolio – Design', bounds: { x: 900, y: 0, width: 900, height: 450 }, minimized: false }
  ]
  const matches = matchSelectedTargets(workspace, { displays, windows }, [
    { targetId: 'editor', windowHandle: '10' },
    { targetId: 'url:local', windowHandle: '20' },
    { targetId: 'url:figma', windowHandle: '30' }
  ])
  assert.deepEqual(matches.map((item) => item.window?.handle), ['10', '20', '30'])
  assert.throws(() => matchSelectedTargets(workspace, { displays, windows }, [
    { targetId: 'url:local', windowHandle: '20' },
    { targetId: 'url:figma', windowHandle: '20' }
  ]), /different window/)
})
