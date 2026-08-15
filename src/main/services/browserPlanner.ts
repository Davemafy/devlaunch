import type { Workspace, WorkspaceURL } from '../../shared/types'

export type BrowserLaunch = { name?: string; browser: string; profile?: string; urls: WorkspaceURL[] }

export function planBrowserLaunches(workspace: Workspace, urls: WorkspaceURL[]): BrowserLaunch[] {
  const grouped = new Map<string, WorkspaceURL[]>()
  const launches: BrowserLaunch[] = []
  for (const url of urls) {
    if (!url.groupId) {
      launches.push({ browser: url.browser || workspace.browser || 'Chrome', urls: [url] })
      continue
    }
    grouped.set(url.groupId, [...(grouped.get(url.groupId) || []), url])
  }
  for (const [groupId, members] of grouped) {
    const group = workspace.browserGroups?.find((item) => item.id === groupId)
    launches.push({ name: group?.name || 'browser group', browser: group?.browser || members[0]?.browser || workspace.browser || 'Chrome', profile: group?.profile, urls: members })
  }
  return launches
}
