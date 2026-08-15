import type { NamedWorkspaceLayout, Workspace, WorkspaceMode } from './types'

const isLocalUrl = (value: string) => {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname) } catch { return false }
}

export function workspaceModes(workspace: Workspace): WorkspaceMode[] {
  if (workspace.modes?.length) return workspace.modes
  const full: WorkspaceMode = { id: 'full', name: 'Full workspace', description: 'Everything configured for this workspace' }
  const code: WorkspaceMode = {
    id: 'code', name: 'Code', description: 'Editor, services, and local development URLs',
    commandIds: workspace.commands.filter((item) => item.runOnLaunch).map((item) => item.id),
    urlIds: workspace.urls.filter((item) => item.openOnLaunch && isLocalUrl(item.url)).map((item) => item.id), appIds: []
  }
  const designUrls = workspace.urls.filter((item) => item.openOnLaunch && !isLocalUrl(item.url)).map((item) => item.id)
  const modes = [full, code]
  if (designUrls.length || workspace.apps.length) modes.push({ id: 'design', name: 'Design review', description: 'Design links and configured apps', commandIds: [], urlIds: designUrls, appIds: workspace.apps.filter((item) => item.openOnLaunch).map((item) => item.id) })
  return modes
}

export function resolveWorkspaceMode(workspace: Workspace, modeId?: string) {
  return workspaceModes(workspace).find((mode) => mode.id === (modeId || 'full')) || workspaceModes(workspace)[0]
}

export function workspaceLayouts(workspace: Workspace): NamedWorkspaceLayout[] {
  if (workspace.layouts?.length) return workspace.layouts
  return workspace.layout ? [{ id: 'default', name: 'Default', layout: workspace.layout }] : []
}

export function resolveWorkspaceLayout(workspace: Workspace, modeId?: string, layoutId?: string) {
  const layouts = workspaceLayouts(workspace)
  const mode = resolveWorkspaceMode(workspace, modeId)
  return layouts.find((item) => item.id === (layoutId || mode.layoutId || workspace.defaultLayoutId))
    || layouts.find((item) => item.modeId === mode.id)
    || layouts[0]
}
