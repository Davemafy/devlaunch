import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { ProcessManager } from '../src/main/services/processManager'
import { checkHttp, inspectPort } from '../src/main/services/portManager'
import type { WorkspaceCommand } from '../src/shared/types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('tracks and stops only a DevLaunch-owned process', async () => {
  const manager = new ProcessManager()
  const command: WorkspaceCommand = {
    id: 'frontend', name: 'Frontend', command: `${process.execPath} -e "console.log('ready');setInterval(()=>{},1000)"`,
    runOnLaunch: true, order: 0
  }
  const started = manager.start('workspace-a', command, process.cwd())
  assert.ok(started.pid)
  await wait(250)
  assert.equal(manager.isRunning('workspace-a'), true)
  assert.match(manager.get('workspace-a')[0].logs.join('\n'), /ready/)
  await manager.stop('workspace-a')
  assert.equal(manager.isRunning('workspace-a'), false)
  assert.equal(manager.get('workspace-a')[0].state, 'stopped')
})

test('detects an occupied port and HTTP readiness', async () => {
  const server = createServer((_request, response) => { response.writeHead(200); response.end('ok') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}`
  assert.equal(await checkHttp(url), true)
  const conflict = await inspectPort(url)
  assert.equal(conflict?.port, address.port)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  assert.equal(await inspectPort(url), null)
})
