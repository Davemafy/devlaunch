import Store from 'electron-store'
import type { Preferences, Workspace } from '../../shared/types'

type Schema = { workspaces: Workspace[]; preferences: Preferences }
const defaultPreferences: Preferences = { launchAtLogin: false, startHidden: false, minimizeToTray: true, defaultBrowser: 'Chrome', globalLauncher: true, notifications: true }
const store = new Store<Schema>({ defaults: { workspaces: [], preferences: defaultPreferences } })

export const workspaceStore = {
  list: () => store.get('workspaces'),
  get: (id: string) => store.get('workspaces').find((item) => item.id === id),
  save: (workspace: Workspace) => {
    const all = store.get('workspaces')
    const next = all.some((item) => item.id === workspace.id)
      ? all.map((item) => (item.id === workspace.id ? workspace : item))
      : [...all, workspace]
    store.set('workspaces', next)
    return next
  },
  delete: (id: string) => {
    const next = store.get('workspaces').filter((item) => item.id !== id)
    store.set('workspaces', next)
    return next
  },
  markLaunched: (id: string, readyAt: number, readyTimeMs: number) => {
    const next = store.get('workspaces').map((item) => item.id === id ? {
      ...item,
      lastLaunchedAt: new Date(readyAt).toISOString(),
      lastReadyTimeMs: readyTimeMs,
      updatedAt: new Date().toISOString()
    } : item)
    store.set('workspaces', next)
    return next
  }
}

export const preferencesStore = {
  get: () => ({ ...defaultPreferences, ...store.get('preferences') }),
  save: (preferences: Preferences) => { store.set('preferences', preferences); return preferences }
}
