import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AppWindow, ArrowLeft, Check, ChevronDown, Circle, Code2, Command,
  ExternalLink, FileCode2, Folder, FolderOpen, Globe2, LayoutGrid, LoaderCircle,
  MonitorDown, Pencil, Play, Plus, RotateCcw, Search, Settings, Square, Terminal,
  Trash2, X, Zap
} from 'lucide-react'
import type { LayoutCaptureOptions, LayoutCapturePreview, LayoutWindowCandidate, LayoutWindowSelection, LaunchEvent, LaunchResult, Preferences, ProcessInfo, ProjectDetection, Workspace, WorkspaceApp, WorkspaceBrowserGroup, WorkspaceCommand, WorkspaceLayout, WorkspaceURL } from '../../shared/types'
import { workspaceLayouts, workspaceModes } from '../../shared/workspaceModes'

const uid = () => crypto.randomUUID()

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'home' | 'create' | 'detail' | 'edit' | 'settings'>('home')
  const [selectedId, setSelectedId] = useState<string>()
  const [palette, setPalette] = useState(false)
  const [launching, setLaunching] = useState<string>()
  const [events, setEvents] = useState<LaunchEvent[]>([])
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string>()
  const [decision, setDecision] = useState<LaunchResult>()
  const [layoutPicker, setLayoutPicker] = useState<{ workspace: Workspace; preview: LayoutCapturePreview; modeId?: string }>()
  const [openWorkspacePicker, setOpenWorkspacePicker] = useState<LayoutWindowCandidate[]>()

  const selected = workspaces.find((item) => item.id === selectedId)
  const filtered = useMemo(() => workspaces.filter((item) => `${item.name} ${item.framework} ${item.projectPath}`.toLowerCase().includes(query.toLowerCase())), [workspaces, query])

  useEffect(() => { window.devlaunch.listWorkspaces().then(async (all) => { setWorkspaces(all); const runtimes = await Promise.all(all.map((workspace) => window.devlaunch.getRuntime(workspace.id))); setRuntimeStatus(Object.fromEntries(runtimes.map((runtime) => [runtime.workspaceId, runtime.status]))) }) }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette((open) => !open) }
      if (event.key === 'Escape') { setPalette(false); if (launching) setLaunching(undefined) }
    }
    window.addEventListener('keydown', keydown)
    const offEvent = window.devlaunch.onLaunchEvent((event) => {
      setEvents((current) => [...current.filter((item) => !(item.workspaceId === event.workspaceId && item.step === event.step)), event])
      if (event.step === 'workspace' && event.state === 'complete') window.devlaunch.getProcesses(event.workspaceId).then(setProcesses)
      if (event.step === 'workspace') setRuntimeStatus((current) => ({ ...current, [event.workspaceId]: event.message === 'Workspace stopped' ? 'stopped' : event.state === 'active' ? 'launching' : event.state === 'complete' ? 'running' : current[event.workspaceId] }))
    })
    const offProcess = window.devlaunch.onProcessUpdate((process) => setProcesses((current) => [...current.filter((item) => !(item.workspaceId === process.workspaceId && item.commandId === process.commandId)), process]))
    const offTray = window.devlaunch.onTrayLaunch((workspaceId) => { void window.devlaunch.launchWorkspace(workspaceId).then((result) => { if (result.status === 'already-running') void window.devlaunch.focusWorkspace(workspaceId) }) })
    const offLauncher = window.devlaunch.onOpenLauncher(() => setPalette(true))
    return () => { window.removeEventListener('keydown', keydown); offEvent(); offProcess(); offTray(); offLauncher() }
  }, [launching])

  async function launch(workspace: Workspace, behavior: 'normal' | 'another' | 'use-existing' = 'normal', modeId?: string) {
    if (behavior !== 'another') setEvents([])
    setDecision(undefined); setLaunching(workspace.id); setSelectedId(workspace.id)
    const result = await window.devlaunch.launchWorkspace(workspace.id, behavior, modeId)
    if (result.status === 'already-running' || result.status === 'port-conflict') setDecision(result)
    if (result.status === 'launched') {
      setProcesses(await window.devlaunch.getProcesses(workspace.id))
      setWorkspaces(await window.devlaunch.listWorkspaces())
    }
  }
  async function stop(id: string) { await window.devlaunch.stopWorkspace(id); setProcesses(await window.devlaunch.getProcesses(id)) }
  async function focus(workspace: Workspace) {
    const result = await window.devlaunch.focusWorkspace(workspace.id)
    setNotice(result.focused ? `${workspace.name} focused` : 'No matching workspace windows found')
    window.setTimeout(() => setNotice(undefined), 2600)
  }
  async function restart(workspace: Workspace, modeId?: string) {
    setEvents([]); setDecision(undefined); setLaunching(workspace.id)
    const result = await window.devlaunch.restartWorkspace(workspace.id, modeId)
    if (result.status === 'port-conflict') setDecision(result)
    setProcesses(await window.devlaunch.getProcesses(workspace.id))
  }
  async function addToDesktop(workspace: Workspace) {
    try {
      await window.devlaunch.createDesktopShortcut(workspace.id)
      setNotice(`${workspace.name} added to your desktop`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Desktop shortcut could not be created')
    }
    window.setTimeout(() => setNotice(undefined), 3200)
  }
  async function captureLayout(workspace: Workspace, modeId?: string) {
    try {
      const preview = await window.devlaunch.previewCurrentLayout(workspace.id)
      if (!preview.windows.length) throw new Error('No matching application windows are open')
      setLayoutPicker({ workspace, preview, modeId })
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Windows could not be detected'
      setNotice(message)
      window.setTimeout(() => setNotice(undefined), 4200)
    }
  }
  async function saveLayout(workspace: Workspace, selections: LayoutWindowSelection[], options: LayoutCaptureOptions) {
    try {
      const result = await window.devlaunch.captureCurrentLayout(workspace.id, selections, options)
      setWorkspaces(await window.devlaunch.listWorkspaces())
      const missing = result.unmatched.length ? ` · Not found: ${result.unmatched.join(', ')}` : ''
      setNotice(`Captured ${result.captured} window${result.captured === 1 ? '' : 's'}${missing}`)
      setLayoutPicker(undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Layout could not be captured'
      setNotice(message)
    }
    window.setTimeout(() => setNotice(undefined), 4200)
  }
  async function restoreLayout(workspace: Workspace, layoutId?: string) {
    try {
      const result = await window.devlaunch.restoreLayout(workspace.id, layoutId)
      setNotice(result.missing.length ? `Restored ${result.restored}; not found: ${result.missing.join(', ')}` : `Restored ${result.restored} windows`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Layout could not be restored')
    }
    window.setTimeout(() => setNotice(undefined), 4200)
  }
  function openDetail(workspace: Workspace) { setSelectedId(workspace.id); setView('detail'); window.devlaunch.getProcesses(workspace.id).then(setProcesses) }
  async function previewOpenWorkspace() {
    try {
      const windows = await window.devlaunch.previewOpenWindows()
      if (!windows.length) throw new Error('No capturable application windows are open')
      setOpenWorkspacePicker(windows)
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Open windows could not be detected')
      window.setTimeout(() => setNotice(undefined), 4200)
    }
  }
  async function saveOpenWorkspace(name: string, windowHandles: string[], createDesktopShortcut: boolean) {
    try {
      const result = await window.devlaunch.createWorkspaceFromOpenWindows({ name, windowHandles, createDesktopShortcut })
      setWorkspaces(result.workspaces); setSelectedId(result.workspace.id); setOpenWorkspacePicker(undefined)
      setNotice(`${result.workspace.name} captured${createDesktopShortcut && !result.shortcutCreated ? ' · desktop icon could not be created' : ''}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Workspace could not be captured')
    }
    window.setTimeout(() => setNotice(undefined), 4200)
  }

  return <div className="app-shell">
    <Sidebar view={view} onHome={() => setView('home')} onAdd={() => setView('create')} onSettings={() => setView('settings')} />
    <main>
      {view === 'home' && <Home workspaces={filtered} allCount={workspaces.length} query={query} setQuery={setQuery} onAdd={() => setView('create')} onCapture={previewOpenWorkspace} onLaunch={launch} onFocus={focus} onRestart={restart} onOpen={openDetail} onShortcut={addToDesktop} processes={processes} runtimeStatus={runtimeStatus} />}
      {view === 'create' && <CreateWorkspace onCancel={() => setView('home')} onSave={async (workspace, createShortcut) => { const all = await window.devlaunch.saveWorkspace(workspace); setWorkspaces(all); setSelectedId(workspace.id); if (createShortcut) await addToDesktop(workspace); setView('home') }} />}
      {view === 'detail' && selected && <WorkspaceDetails workspace={selected} runtimeStatus={runtimeStatus[selected.id]} processes={processes.filter((item) => item.workspaceId === selected.id)} onBack={() => setView('home')} onEdit={() => setView('edit')} onLaunch={(modeId: string) => launch(selected, 'normal', modeId)} onFocus={() => focus(selected)} onRestart={(modeId: string) => restart(selected, modeId)} onStop={() => stop(selected.id)} onShortcut={() => addToDesktop(selected)} onCaptureLayout={(modeId: string) => captureLayout(selected, modeId)} onRestoreLayout={(layoutId: string) => restoreLayout(selected, layoutId)} onDelete={async () => { setWorkspaces(await window.devlaunch.deleteWorkspace(selected.id)); setView('home') }} />}
      {view === 'edit' && selected && <WorkspaceEditor workspace={selected} onCancel={() => setView('detail')} onSave={async (workspace) => { setWorkspaces(await window.devlaunch.saveWorkspace(workspace)); setView('detail'); setNotice('Workspace updated'); window.setTimeout(() => setNotice(undefined), 2600) }}/>} 
      {view === 'settings' && <SettingsPage onBack={() => setView('home')}/>} 
    </main>
    {palette && <CommandPalette workspaces={workspaces} onClose={() => setPalette(false)} onLaunch={(workspace: Workspace) => { setPalette(false); launch(workspace) }} onCreate={() => { setPalette(false); setView('create') }} onCapture={() => { setPalette(false); void previewOpenWorkspace() }} onSettings={() => { setPalette(false); setView('settings') }} onStop={() => { if (selected) void stop(selected.id); setPalette(false) }}/>} 
    {layoutPicker && <LayoutCapturePicker workspace={layoutPicker.workspace} preview={layoutPicker.preview} initialModeId={layoutPicker.modeId} onClose={() => setLayoutPicker(undefined)} onSave={(selections, options) => saveLayout(layoutPicker.workspace, selections, options)}/>} 
    {openWorkspacePicker && <OpenWorkspacePicker windows={openWorkspacePicker} onClose={() => setOpenWorkspacePicker(undefined)} onSave={saveOpenWorkspace}/>} 
    {launching && <LaunchProgress workspace={workspaces.find((item) => item.id === launching)!} events={events.filter((item) => item.workspaceId === launching)} processes={processes.filter((item) => item.workspaceId === launching)} decision={decision} onClose={() => { setLaunching(undefined); setDecision(undefined) }} onStop={() => stop(launching)} onFocus={async () => { if (selected) await focus(selected); setLaunching(undefined); setDecision(undefined) }} onRestart={() => selected && restart(selected)} onLaunchAnother={() => selected && launch(selected, 'another')} onUseExisting={() => selected && launch(selected, 'use-existing')} />}
    {notice && <div className="toast"><Check size={15}/>{notice}</div>}
  </div>
}

function Sidebar({ view, onHome, onAdd, onSettings }: { view: string; onHome(): void; onAdd(): void; onSettings(): void }) {
  return <aside>
    <div className="brand"><span className="brand-mark"><Zap size={15} fill="currentColor" /></span><span>DevLaunch</span></div>
    <nav>
      <button className={view === 'home' ? 'active' : ''} onClick={onHome}><LayoutGrid size={16} /> Workspaces</button>
      <button className={view === 'create' ? 'active' : ''} onClick={onAdd}><Plus size={16} /> Add workspace</button>
    </nav>
    <div className="aside-bottom">
      <button className={view === 'settings' ? 'active' : ''} onClick={onSettings}><Settings size={16} /> Settings</button>
      <div className="shortcut"><span>Command menu</span><kbd>Ctrl K</kbd></div>
    </div>
  </aside>
}

function Home({ workspaces, allCount, query, setQuery, onAdd, onCapture, onLaunch, onFocus, onRestart, onOpen, onShortcut, processes, runtimeStatus }: any) {
  return <div className="page home-page">
    <header className="page-header">
      <div><p className="eyebrow">WORKSPACES</p><h1>Ready when you are.</h1><p>Restore every tool, process and tab in one launch.</p></div>
      <div className="header-actions"><button className="secondary" onClick={onCapture}><AppWindow size={15}/> Capture open apps</button><button className="primary" onClick={onAdd}><Plus size={16} /> Add developer workspace</button></div>
    </header>
    <div className="toolbar">
      <label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search workspaces, frameworks, paths…" /></label>
      <span className="count">{allCount} {allCount === 1 ? 'workspace' : 'workspaces'}</span>
    </div>
    {workspaces.length ? <div className="workspace-list">
      {workspaces.map((workspace: Workspace) => {
        const running = ['launching', 'running', 'degraded'].includes(runtimeStatus[workspace.id]) || processes.some((item: ProcessInfo) => item.workspaceId === workspace.id && ['starting', 'waiting', 'running', 'ready', 'degraded'].includes(item.state))
        return <article className="workspace-row" tabIndex={0} key={workspace.id} onClick={() => onOpen(workspace)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(workspace) }}>
          <div className="project-icon"><FileCode2 size={20} /></div>
          <div className="workspace-main"><div className="title-row"><h2>{workspace.name}</h2>{running && <span className="status running"><i /> Running</span>}</div><p>{workspace.framework || 'Local project'}</p><code>{workspace.projectPath}</code></div>
          <div className="workspace-tools">
            {workspace.editor && <span><Code2 size={15} /> VS Code</span>}
            {!workspace.editor && workspace.apps[0] && <span><AppWindow size={15} /> {workspace.apps.length} {workspace.apps.length === 1 ? 'app' : 'apps'}</span>}
            {workspace.commands[0] && <span><Terminal size={15} /> {workspace.commands[0].command}</span>}
            {workspace.urls.some((url) => url.openOnLaunch) && <span><Globe2 size={15} /> {workspace.urls.filter((url) => url.openOnLaunch).length} {workspace.urls.filter((url) => url.openOnLaunch).length === 1 ? 'URL' : 'URLs'}</span>}
          </div>
          <div className="row-actions">{running ? <><button className="launch" onClick={(event) => { event.stopPropagation(); onFocus(workspace) }}>Focus</button><button className="icon-button" title="Restart workspace" onClick={(event) => { event.stopPropagation(); onRestart(workspace) }}><RotateCcw size={15}/></button></> : <button className="launch" onClick={(event) => { event.stopPropagation(); onLaunch(workspace) }}><Play size={15} fill="currentColor" /> Launch</button>}</div>
          <button className="icon-button" title="Add workspace to desktop" aria-label="Add workspace to desktop" onClick={(event) => { event.stopPropagation(); onShortcut(workspace) }}><MonitorDown size={17} /></button>
        </article>
      })}
    </div> : <div className="empty">
      <div className="empty-illustration"><span className="mini-window code"><i/><i/><i/></span><span className="route"/><span className="mini-window browser"><i/></span><Zap size={24}/></div>
      <h2>{allCount ? 'No matching workspaces' : 'Your first launch is one folder away'}</h2>
      <p>{allCount ? 'Try a different name, framework, or path.' : 'Choose a project. DevLaunch detects the framework and suggests the right startup command.'}</p>
      {!allCount && <button className="primary" onClick={onAdd}><FolderOpen size={16} /> Choose a project folder</button>}
    </div>}
  </div>
}

function OpenWorkspacePicker({ windows, onClose, onSave }: { windows: LayoutWindowCandidate[]; onClose(): void; onSave(name: string, handles: string[], createDesktopShortcut: boolean): void }) {
  const [name, setName] = useState('My workspace')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(windows.map((window) => window.handle)))
  const [desktop, setDesktop] = useState(true)
  const browserProcesses = new Set(['chrome', 'msedge', 'firefox', 'brave'])
  const toggle = (handle: string) => setSelected((current) => { const next = new Set(current); next.has(handle) ? next.delete(handle) : next.add(handle); return next })
  return <div className="modal-backdrop"><section className="open-workspace-picker">
    <header><div><p className="eyebrow">CAPTURE OPEN WORKSPACE</p><h2>Turn your current desktop into one launch</h2><p>Select the apps DevLaunch should reopen and reposition.</p></div><button className="icon-button" onClick={onClose}><X size={18}/></button></header>
    <label className="capture-name"><span>Workspace name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Morning setup"/></label>
    <div className="open-window-list">{windows.map((window) => {
      const browser = browserProcesses.has(window.processName.toLowerCase())
      return <label className={selected.has(window.handle) ? 'selected' : ''} key={window.handle}><input type="checkbox" checked={selected.has(window.handle)} onChange={() => toggle(window.handle)}/><span className="step-icon">{browser ? <Globe2 size={15}/> : <AppWindow size={15}/>}</span><div><strong>{window.title}</strong><small>{window.processName} · Display {window.displayIndex + 1}{browser ? ' · active browser window' : ''}</small></div></label>
    })}</div>
    <div className="browser-capture-note"><Globe2 size={15}/><span><strong>Browser note</strong>DevLaunch captures the browser app, active window title, and position. Exact tab URLs need a future browser extension; Chrome may restore tabs if “Continue where you left off” is enabled.</span></div>
    <label className="desktop-option compact"><input type="checkbox" checked={desktop} onChange={(event) => setDesktop(event.target.checked)}/><span><MonitorDown size={16}/><strong>Add this workspace to desktop</strong><small>Launch the captured setup from its own icon.</small></span></label>
    <footer><span>{selected.size} window{selected.size === 1 ? '' : 's'} selected</span><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim() || !selected.size} onClick={() => onSave(name.trim(), [...selected], desktop)}><Check size={15}/> Save workspace</button></footer>
  </section></div>
}

function CreateWorkspace({ onCancel, onSave }: { onCancel(): void; onSave(workspace: Workspace, createDesktopShortcut: boolean): void }) {
  const [path, setPath] = useState('')
  const [detection, setDetection] = useState<ProjectDetection>()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [localUrl, setLocalUrl] = useState('')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true)

  async function choose() {
    const folder = await window.devlaunch.chooseFolder(); if (!folder) return
    setPath(folder); setLoading(true)
    try { const result = await window.devlaunch.detectProject(folder); setDetection(result); setName(result.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())); setCommand(result.suggestedCommand); setLocalUrl(result.suggestedUrl) } finally { setLoading(false) }
  }
  function save() {
    if (!name.trim() || !path.trim()) return
    const now = new Date().toISOString()
    const commandId = uid()
    const commands: WorkspaceCommand[] = command.trim() ? [{ id: commandId, name: detection?.framework.includes('Vite') ? 'Vite' : 'Dev server', command, runOnLaunch: true, cwd: path, waitForUrl: localUrl || undefined, healthCheck: localUrl ? { type: 'http', target: localUrl, timeout: 30_000, interval: 500 } : { type: 'process', target: command }, order: 0 }] : []
    const urls: WorkspaceURL[] = [
      ...(localUrl ? [{ id: uid(), name: 'Localhost', url: localUrl, browser: 'Chrome', openOnLaunch: true, waitForReady: true }] : []),
      ...(figmaUrl ? [{ id: uid(), name: 'Figma', url: figmaUrl, browser: 'Chrome', openOnLaunch: true, waitForReady: false }] : [])
    ]
    onSave({ id: uid(), name: name.trim(), projectPath: path, framework: detection?.framework, editor: { command: 'code' }, browser: 'Chrome', commands, urls, apps: [], createdAt: now, updatedAt: now }, createDesktopShortcut)
  }
  return <div className="page create-page">
    <button className="back" onClick={onCancel}><ArrowLeft size={16} /> Workspaces</button>
    <div className="form-heading"><p className="eyebrow">NEW WORKSPACE</p><h1>Set it once. Launch it anytime.</h1><p>DevLaunch will only run the command you review and save here.</p></div>
    <section className="form-card">
      <div className="section-title"><span>01</span><div><h2>Project</h2><p>Choose the local project you want to restore.</p></div></div>
      <label className="field"><span>Project folder</span><div className="folder-field"><Folder size={16}/><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\David\Documents\trailer-park"/><button onClick={choose}>{loading ? <LoaderCircle className="spin" size={16}/> : 'Choose folder'}</button></div></label>
      {detection && <div className="detection"><Check size={15}/><div><strong>Project detected</strong><span>{detection.framework} · {detection.packageManager} · {detection.scripts.length} scripts</span></div></div>}
      <label className="field"><span>Workspace name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Trailer Park"/></label>
    </section>
    <section className="form-card">
      <div className="section-title"><span>02</span><div><h2>Launch sequence</h2><p>Review exactly what DevLaunch will start.</p></div></div>
      <div className="two-col"><label className="field"><span>Editor</span><div className="select-like"><Code2 size={16}/>VS Code<ChevronDown size={15}/></div></label><label className="field"><span>Browser</span><div className="select-like"><Globe2 size={16}/>Google Chrome<ChevronDown size={15}/></div></label></div>
      <label className="field"><span>Startup command</span><div className="command-field"><Terminal size={16}/><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm run dev"/></div><small>Runs inside {path || 'the selected project folder'}</small></label>
      <label className="field"><span>Local URL</span><input value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="http://localhost:5173"/><small>DevLaunch waits for this URL before opening Chrome.</small></label>
      <label className="field"><span>Design URL <em>Optional</em></span><input value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)} placeholder="https://figma.com/design/…"/></label>
      <label className="desktop-option"><input type="checkbox" checked={createDesktopShortcut} onChange={(event) => setCreateDesktopShortcut(event.target.checked)}/><span><MonitorDown size={16}/><strong>Add workspace to desktop</strong><small>Creates a {name || 'workspace'} icon that launches this setup directly.</small></span></label>
    </section>
    <div className="form-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={!name || !path} onClick={save}><Check size={16}/> Save workspace</button></div>
  </div>
}

function WorkspaceEditor({ workspace, onCancel, onSave }: { workspace: Workspace; onCancel(): void; onSave(workspace: Workspace): void }) {
  const [draft, setDraft] = useState<Workspace>(() => structuredClone(workspace))
  const updateCommand = (id: string, patch: Partial<WorkspaceCommand>) => setDraft((current) => ({ ...current, commands: current.commands.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  const updateUrl = (id: string, patch: Partial<WorkspaceURL>) => setDraft((current) => ({ ...current, urls: current.urls.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  const updateApp = (id: string, patch: Partial<WorkspaceApp>) => setDraft((current) => ({ ...current, apps: current.apps.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  const updateGroup = (id: string, patch: Partial<WorkspaceBrowserGroup>) => setDraft((current) => ({ ...current, browserGroups: (current.browserGroups || []).map((item) => item.id === id ? { ...item, ...patch } : item) }))
  const valid = draft.name.trim() && draft.projectPath.trim() && draft.commands.every((item) => item.name.trim() && item.command.trim()) && draft.urls.every((item) => item.name.trim() && /^https?:\/\//i.test(item.url)) && draft.apps.every((item) => item.name.trim() && item.executable.trim()) && (draft.browserGroups || []).every((item) => item.name.trim())
  return <div className="page create-page editor-page">
    <button className="back" onClick={onCancel}><ArrowLeft size={16}/> Workspace details</button>
    <div className="form-heading"><p className="eyebrow">EDIT WORKSPACE</p><h1>{workspace.name}</h1><p>Configure every command, URL, application, and browser group used during launch.</p></div>
    <section className="form-card"><div className="section-title"><span>01</span><div><h2>General</h2><p>Name, project folder, editor, and browser.</p></div></div>
      <div className="two-col"><label className="field"><span>Workspace name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label><label className="field"><span>Framework label</span><input value={draft.framework || ''} onChange={(event) => setDraft({ ...draft, framework: event.target.value })}/></label></div>
      <label className="field"><span>Project or working folder</span><div className="folder-field"><Folder size={15}/><input value={draft.projectPath} onChange={(event) => setDraft({ ...draft, projectPath: event.target.value })}/><button onClick={async () => { const path = await window.devlaunch.chooseFolder(); if (path) setDraft({ ...draft, projectPath: path }) }}>Choose</button></div></label>
      <div className="two-col"><label className="field"><span>Editor command <em>Optional</em></span><input value={draft.editor?.command || ''} onChange={(event) => setDraft({ ...draft, editor: event.target.value ? { command: event.target.value } : undefined })} placeholder="code"/></label><label className="field"><span>Default browser</span><input value={draft.browser || 'Chrome'} onChange={(event) => setDraft({ ...draft, browser: event.target.value })}/></label></div>
    </section>
    <section className="form-card"><EditableSection title="Startup commands" description="Run several services in a stable order." onAdd={() => setDraft({ ...draft, commands: [...draft.commands, { id: uid(), name: 'New command', command: '', cwd: draft.projectPath, runOnLaunch: true, order: draft.commands.length }] })}/>
      <div className="config-list">{draft.commands.map((command) => <div className="config-row command-config" key={command.id}><input value={command.name} onChange={(event) => updateCommand(command.id, { name: event.target.value })} placeholder="Frontend"/><input className="mono" value={command.command} onChange={(event) => updateCommand(command.id, { command: event.target.value })} placeholder="npm run dev"/><input className="mono" value={command.cwd || ''} onChange={(event) => updateCommand(command.id, { cwd: event.target.value })} placeholder="Working directory"/><label><input type="checkbox" checked={command.runOnLaunch} onChange={(event) => updateCommand(command.id, { runOnLaunch: event.target.checked })}/> On</label><button className="icon-button" onClick={() => setDraft({ ...draft, commands: draft.commands.filter((item) => item.id !== command.id) })}><Trash2 size={14}/></button></div>)}</div>
    </section>
    <section className="form-card"><EditableSection title="URLs" description="Open localhost, design files, dashboards, and documentation." onAdd={() => setDraft({ ...draft, urls: [...draft.urls, { id: uid(), name: 'New URL', url: 'https://', browser: draft.browser || 'Chrome', openOnLaunch: true }] })}/>
      <div className="config-list">{draft.urls.map((url) => <div className="config-row url-config" key={url.id}><input value={url.name} onChange={(event) => updateUrl(url.id, { name: event.target.value })}/><input className="mono" value={url.url} onChange={(event) => updateUrl(url.id, { url: event.target.value })}/><select value={url.groupId || ''} onChange={(event) => updateUrl(url.id, { groupId: event.target.value || undefined })}><option value="">Separate window</option>{draft.browserGroups?.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><label><input type="checkbox" checked={url.openOnLaunch} onChange={(event) => updateUrl(url.id, { openOnLaunch: event.target.checked })}/> On</label><button className="icon-button" onClick={() => setDraft({ ...draft, urls: draft.urls.filter((item) => item.id !== url.id) })}><Trash2 size={14}/></button></div>)}</div>
    </section>
    <section className="form-card"><EditableSection title="Browser groups" description="Open related URLs in one Chrome window and optional profile." onAdd={() => setDraft({ ...draft, browserGroups: [...(draft.browserGroups || []), { id: uid(), name: 'Browser group', browser: 'Chrome' }] })}/>
      <div className="config-list">{draft.browserGroups?.map((group) => <div className="config-row group-config" key={group.id}><input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })}/><input value={group.browser || 'Chrome'} onChange={(event) => updateGroup(group.id, { browser: event.target.value })}/><input value={group.profile || ''} onChange={(event) => updateGroup(group.id, { profile: event.target.value })} placeholder="Profile 1 (optional)"/><button className="icon-button" onClick={() => setDraft({ ...draft, browserGroups: draft.browserGroups?.filter((item) => item.id !== group.id), urls: draft.urls.map((url) => url.groupId === group.id ? { ...url, groupId: undefined } : url) })}><Trash2 size={14}/></button></div>)}</div>
    </section>
    <section className="form-card"><EditableSection title="Applications" description="Launch desktop tools using their executable paths." onAdd={() => setDraft({ ...draft, apps: [...draft.apps, { id: uid(), name: 'New application', executable: '', openOnLaunch: true }] })}/>
      <div className="config-list">{draft.apps.map((app) => <div className="config-row app-config" key={app.id}><input value={app.name} onChange={(event) => updateApp(app.id, { name: event.target.value })}/><div className="folder-field"><input className="mono" value={app.executable} onChange={(event) => updateApp(app.id, { executable: event.target.value })}/><button onClick={async () => { const path = await window.devlaunch.chooseExecutable(); if (path) updateApp(app.id, { executable: path }) }}>Choose</button></div><label><input type="checkbox" checked={app.openOnLaunch} onChange={(event) => updateApp(app.id, { openOnLaunch: event.target.checked })}/> On</label><button className="icon-button" onClick={() => setDraft({ ...draft, apps: draft.apps.filter((item) => item.id !== app.id) })}><Trash2 size={14}/></button></div>)}</div>
    </section>
    <div className="form-actions"><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={!valid} onClick={() => onSave({ ...draft, updatedAt: new Date().toISOString() })}><Check size={15}/> Save changes</button></div>
  </div>
}

function EditableSection({ title, description, onAdd }: { title: string; description: string; onAdd(): void }) {
  return <div className="section-title editable-title"><span><Settings size={13}/></span><div><h2>{title}</h2><p>{description}</p></div><button className="secondary small" onClick={onAdd}><Plus size={13}/> Add</button></div>
}

function SettingsPage({ onBack }: { onBack(): void }) {
  const [preferences, setPreferences] = useState<Preferences>()
  const [saved, setSaved] = useState(false)
  useEffect(() => { void window.devlaunch.getPreferences().then(setPreferences) }, [])
  if (!preferences) return <div className="page"><LoaderCircle className="spin"/></div>
  const toggle = (key: keyof Pick<Preferences, 'launchAtLogin' | 'startHidden' | 'minimizeToTray' | 'globalLauncher' | 'notifications'>) => setPreferences({ ...preferences, [key]: !preferences[key] })
  return <div className="page settings-page"><button className="back" onClick={onBack}><ArrowLeft size={16}/> Workspaces</button><div className="form-heading"><p className="eyebrow">SETTINGS</p><h1>DevLaunch preferences</h1><p>Windows startup, tray behavior, and launch defaults.</p></div><section className="form-card settings-card">
    <SettingToggle title="Launch DevLaunch when Windows starts" description="Keeps workspace shortcuts and tray launch ready after sign-in." checked={preferences.launchAtLogin} onChange={() => toggle('launchAtLogin')}/>
    <SettingToggle title="Start hidden in the system tray" description="Do not show the dashboard during automatic startup." checked={preferences.startHidden} onChange={() => toggle('startHidden')}/>
    <SettingToggle title="Close button minimizes to tray" description="Use Quit from the tray menu to fully exit DevLaunch." checked={preferences.minimizeToTray} onChange={() => toggle('minimizeToTray')}/>
    <SettingToggle title="Global workspace launcher" description="Open the command launcher anywhere with Ctrl + Alt + Space." checked={preferences.globalLauncher} onChange={() => toggle('globalLauncher')}/>
    <SettingToggle title="Workspace notifications" description="Show a native Windows notification when a workspace is ready or degraded." checked={preferences.notifications} onChange={() => toggle('notifications')}/>
    <label className="setting-row"><span><strong>Default browser</strong><small>Used when a workspace does not specify one.</small></span><select value={preferences.defaultBrowser} onChange={(event) => setPreferences({ ...preferences, defaultBrowser: event.target.value as Preferences['defaultBrowser'] })}><option>Chrome</option><option>Edge</option><option>System</option></select></label>
  </section><div className="form-actions"><button className="primary" onClick={async () => { setPreferences(await window.devlaunch.savePreferences(preferences)); setSaved(true); window.setTimeout(() => setSaved(false), 1800) }}><Check size={15}/>{saved ? 'Saved' : 'Save settings'}</button></div></div>
}

function SettingToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange(): void }) {
  return <label className="setting-row"><span><strong>{title}</strong><small>{description}</small></span><input className="switch" type="checkbox" checked={checked} onChange={onChange}/></label>
}

function WorkspaceDetails({ workspace, runtimeStatus, processes, onBack, onEdit, onLaunch, onFocus, onRestart, onStop, onShortcut, onCaptureLayout, onRestoreLayout, onDelete }: any) {
  const running = ['launching', 'running', 'degraded'].includes(runtimeStatus) || processes.some((item: ProcessInfo) => ['starting', 'waiting', 'running', 'ready', 'degraded'].includes(item.state))
  const modes = workspaceModes(workspace)
  const layouts = workspaceLayouts(workspace)
  const [modeId, setModeId] = useState(modes[0]?.id || 'full')
  const [layoutId, setLayoutId] = useState(workspace.defaultLayoutId || layouts[0]?.id || '')
  const activeLayout = layouts.find((item) => item.id === layoutId) || layouts[0]
  return <div className="page details-page">
    <button className="back" onClick={onBack}><ArrowLeft size={16}/> Workspaces</button>
    <header className="details-header"><div className="project-icon large"><FileCode2 size={24}/></div><div><div className="title-row"><h1>{workspace.name}</h1><span className={`status ${running ? 'running' : ''}`}><i/>{running ? 'Running' : 'Stopped'}</span></div><p>{workspace.framework} · <code>{workspace.projectPath}</code></p></div><div className="details-actions"><button className="secondary" onClick={onEdit}><Pencil size={14}/> Edit</button><button className="secondary" onClick={onShortcut}><MonitorDown size={15}/> Desktop</button>{running && <><button className="secondary" onClick={onStop}><Square size={14} fill="currentColor"/> Stop</button><button className="secondary" onClick={() => onRestart(modeId)}><RotateCcw size={14}/> Restart</button></>}<button className="primary" onClick={running ? onFocus : () => onLaunch(modeId)}>{running ? 'Focus workspace' : <><Play size={15} fill="currentColor"/> Launch workspace</>}</button></div></header>
    <div className="mode-bar"><div><strong>Workspace mode</strong><span>{modes.find((mode) => mode.id === modeId)?.description}</span></div><select value={modeId} onChange={(event) => setModeId(event.target.value)}>{modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></div>
    <div className="detail-grid"><section className="panel"><div className="panel-title"><h2>Launch sequence</h2><span>{workspace.commands.length + workspace.urls.length + workspace.apps.length + (workspace.editor ? 1 : 0)} steps</span></div>
      {workspace.editor && <div className="sequence-item"><span className="step-icon"><Code2 size={16}/></span><div><strong>VS Code</strong><code>{workspace.projectPath}</code></div><Check size={15}/></div>}
      {workspace.commands.map((command: WorkspaceCommand) => <div className="sequence-item" key={command.id}><span className="step-icon"><Terminal size={16}/></span><div><strong>{command.name}</strong><code>{command.command}</code></div><span className="enabled">Enabled</span></div>)}
      {workspace.urls.map((url: WorkspaceURL) => <div className="sequence-item" key={url.id}><span className="step-icon"><Globe2 size={16}/></span><div><strong>{url.name}{url.groupId ? ` · ${workspace.browserGroups?.find((group: any) => group.id === url.groupId)?.name || 'Grouped'}` : ''}</strong><code>{url.url}</code></div><ExternalLink size={15}/></div>)}
      {workspace.apps.map((app: WorkspaceApp) => <div className="sequence-item" key={app.id}><span className="step-icon"><AppWindow size={16}/></span><div><strong>{app.name}</strong><code>{app.executable}</code></div><span className="enabled">Enabled</span></div>)}
    </section><section className="panel"><div className="panel-title"><h2>Processes</h2><span>{processes.length} tracked</span></div>{processes.length ? processes.map((process: ProcessInfo) => <ProcessRow key={`${process.commandId}:${process.instanceId || 'primary'}`} process={process} workspaceId={workspace.id}/>) : <div className="panel-empty"><Activity size={22}/><p>No processes started yet.</p></div>}</section></div>
    <section className="panel layout-section"><div className="panel-title"><div><h2>Window layouts</h2><p>{activeLayout ? `${activeLayout.name} · Captured ${new Date(activeLayout.layout.capturedAt).toLocaleString()}` : 'Arrange your apps once, then capture their positions.'}</p></div><div className="layout-actions">{activeLayout && <button className="secondary small" onClick={() => onRestoreLayout(activeLayout.id)}><AppWindow size={13}/> Restore now</button>}<button className="secondary small" onClick={() => onCaptureLayout(modeId)}><LayoutGrid size={13}/> Capture new layout</button></div></div>{layouts.length > 1 && <div className="layout-tabs">{layouts.map((layout) => <button className={activeLayout?.id === layout.id ? 'active' : ''} key={layout.id} onClick={() => setLayoutId(layout.id)}>{layout.name}{layout.modeId && <small>{modes.find((mode) => mode.id === layout.modeId)?.name}</small>}</button>)}</div>}<LayoutPreview layout={activeLayout?.layout}/></section>
    <button className="danger-link" onClick={onDelete}><Trash2 size={15}/> Delete workspace</button>
  </div>
}

function LayoutPreview({ layout }: { layout?: WorkspaceLayout }) {
  if (!layout?.displays.length) return <div className="layout-empty"><AppWindow size={22}/><div><strong>No layout captured</strong><p>Open the workspace, arrange VS Code and browser windows, then capture.</p></div></div>
  const minX = Math.min(...layout.displays.map((display) => display.bounds.x))
  const minY = Math.min(...layout.displays.map((display) => display.bounds.y))
  const maxX = Math.max(...layout.displays.map((display) => display.bounds.x + display.bounds.width))
  const maxY = Math.max(...layout.displays.map((display) => display.bounds.y + display.bounds.height))
  const width = Math.max(1, maxX - minX); const height = Math.max(1, maxY - minY)
  return <div className="layout-preview-wrap"><div className="layout-preview" style={{ aspectRatio: `${width}/${height}` }}>
    {layout.displays.map((display) => <div className="layout-display" key={display.deviceName} style={{ left: `${(display.bounds.x - minX) / width * 100}%`, top: `${(display.bounds.y - minY) / height * 100}%`, width: `${display.bounds.width / width * 100}%`, height: `${display.bounds.height / height * 100}%` }}><span>{display.primary ? 'Primary' : `Display ${display.index + 1}`}</span>{layout.windows.filter((window) => window.displayDeviceName === display.deviceName).map((window) => <div className={`layout-window ${window.target}`} key={window.id} title={`${window.name} · ${window.title}`} style={{ left: `${window.bounds.x * 100}%`, top: `${window.bounds.y * 100}%`, width: `${window.bounds.width * 100}%`, height: `${window.bounds.height * 100}%` }}><b>{window.name}</b></div>)}</div>)}
  </div><div className="layout-legend">{layout.windows.map((window) => <span key={window.id}><i className={window.target}/>{window.name}<small>Display {window.displayIndex + 1}</small></span>)}</div></div>
}

function LayoutCapturePicker({ workspace, preview, initialModeId, onClose, onSave }: { workspace: Workspace; preview: LayoutCapturePreview; initialModeId?: string; onClose(): void; onSave(selections: LayoutWindowSelection[], options: LayoutCaptureOptions): void }) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries(preview.targets.map((target) => [target.id, target.suggestedHandle || ''])))
  const [name, setName] = useState(`Layout ${workspaceLayouts(workspace).length + 1}`)
  const [modeId, setModeId] = useState(initialModeId || 'full')
  const selected = new Set(Object.values(mapping).filter(Boolean))
  const selections = preview.targets.flatMap((target): LayoutWindowSelection[] => mapping[target.id] ? [{ targetId: target.id, windowHandle: mapping[target.id] }] : [])
  return <div className="modal-backdrop"><section className="layout-picker">
    <header><div><p className="eyebrow">CAPTURE CURRENT LAYOUT</p><h2>Match the windows for {workspace.name}</h2><p>Choose the exact open window for each workspace item. Unassigned items will not be moved.</p></div><button className="icon-button" onClick={onClose}><X size={18}/></button></header>
    <div className="picker-meta"><label><span>Layout name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Default layout"/></label><label><span>Use for mode</span><select value={modeId} onChange={(event) => setModeId(event.target.value)}>{workspaceModes(workspace).map((mode) => <option value={mode.id} key={mode.id}>{mode.name}</option>)}</select></label></div>
    <div className="picker-hint"><AppWindow size={16}/><span>Keep independently positioned pages in separate browser windows. Grouped URLs can share one window.</span></div>
    <div className="window-mapping">{preview.targets.map((target) => <label key={target.id}><span><i className={target.target}/><strong>{target.name}</strong><small>{target.target === 'editor' ? 'Editor' : target.target === 'url' ? 'Browser window' : 'Application'}</small></span><select value={mapping[target.id] || ''} onChange={(event) => setMapping((current) => ({ ...current, [target.id]: event.target.value }))}><option value="">Do not capture</option>{preview.windows.map((candidate) => <option key={candidate.handle} value={candidate.handle} disabled={selected.has(candidate.handle) && mapping[target.id] !== candidate.handle}>{candidate.processName} · {candidate.title} · Display {candidate.displayIndex + 1}</option>)}</select></label>)}</div>
    <footer><span>{selections.length} of {preview.targets.length} assigned</span><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!selections.length || !name.trim()} onClick={() => onSave(selections, { id: uid(), name: name.trim(), modeId, makeDefault: !workspaceLayouts(workspace).length })}><Check size={15}/> Save layout</button></footer>
  </section></div>
}

function ProcessRow({ process, workspaceId }: { process: ProcessInfo; workspaceId: string }) {
  const [logs, setLogs] = useState(false)
  return <div className="process-block"><div className="process-row"><span className={`process-dot ${process.state}`}/><div><strong>{process.name}</strong><span>{process.state}{process.pid ? ` · PID ${process.pid}` : ''}</span></div><button className="icon-button" title="Restart" onClick={() => window.devlaunch.restartProcess(workspaceId, process.commandId)}><RotateCcw size={15}/></button><button className="secondary small" onClick={() => setLogs((open) => !open)}>{logs ? 'Hide output' : 'View output'}</button></div>{logs && <pre>{process.logs.join('\n') || 'Waiting for output…'}</pre>}</div>
}

function LaunchProgress({ workspace, events, processes, decision, onClose, onStop, onFocus, onRestart, onLaunchAnother, onUseExisting }: any) {
  const readyEvent = events.find((item: LaunchEvent) => item.step === 'workspace' && item.state === 'complete' && item.message.startsWith('Workspace ready'))
  const ready = Boolean(readyEvent)
  const failed = events.some((item: LaunchEvent) => item.state === 'failed')
  const duplicate = decision?.status === 'already-running'
  const portConflict = decision?.status === 'port-conflict'
  return <div className="modal-backdrop"><section className="launch-modal">
    <div className="modal-top"><div className={`launch-orb ${ready ? 'done' : ''}`}>{ready ? <Check size={22}/> : duplicate || portConflict ? <Activity size={20}/> : <LoaderCircle className="spin" size={22}/>}</div><div><p className="eyebrow">{ready ? 'WORKSPACE READY' : duplicate ? 'ALREADY RUNNING' : portConflict ? 'ACTION REQUIRED' : 'LAUNCHING WORKSPACE'}</p><h2>{workspace.name}</h2></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div>
    <div className="progress-bar"><i style={{ width: ready ? '100%' : duplicate || portConflict ? '100%' : `${Math.min(88, 14 + events.filter((item: LaunchEvent) => item.state === 'complete').length * 18)}%` }}/></div>
    {duplicate && <div className="decision-card"><strong>{workspace.name} is already running.</strong><p>Focus its existing windows, restart its managed services, or deliberately launch another instance.</p></div>}
    {portConflict && <div className="decision-card warning"><strong>Port {decision.conflict?.port} is already in use.</strong><p>{decision.conflict?.processName ? `${decision.conflict.processName}${decision.conflict.pid ? ` · PID ${decision.conflict.pid}` : ''}` : 'Another process is listening on this port.'} DevLaunch will not stop it automatically.</p></div>}
    <div className="event-list">{events.filter((event: LaunchEvent) => event.step !== 'workspace' || event.state !== 'active').map((event: LaunchEvent) => <div className={`event ${event.state}`} key={event.step}><span>{event.state === 'active' ? <LoaderCircle className="spin" size={15}/> : event.state === 'complete' ? <Check size={15}/> : event.state === 'failed' ? <X size={15}/> : <Circle size={15}/>}</span><p>{event.message}</p></div>)}{!events.length && <div className="event active"><span><LoaderCircle className="spin" size={15}/></span><p>Resolving project…</p></div>}</div>
    {processes[0]?.logs.length > 0 && <pre className="launch-log">{processes[0].logs.slice(-6).join('\n')}</pre>}
    <div className="modal-actions">{duplicate ? <><button className="secondary" onClick={onLaunchAnother}>Launch another</button><button className="secondary" onClick={onRestart}><RotateCcw size={13}/> Restart</button><button className="primary" onClick={onFocus}>Focus</button></> : portConflict ? <><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={onUseExisting}>Use existing service</button></> : <><span>{ready ? (failed ? 'Ready with warnings' : readyEvent?.message) : 'You can keep DevLaunch in the background.'}</span>{!ready && <button className="secondary" onClick={onStop}><Square size={13} fill="currentColor"/> Stop launch</button>}<button className="primary" onClick={onClose}>{ready ? 'Done' : 'Hide'}</button></>}</div>
  </section></div>
}

function CommandPalette({ workspaces, onClose, onLaunch, onCreate, onCapture, onSettings, onStop }: any) {
  const [query, setQuery] = useState(''); const [active, setActive] = useState(0); const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const matches = workspaces.filter((workspace: Workspace) => workspace.name.toLowerCase().includes(query.toLowerCase()))
  const actions = [{ label: 'Capture open apps', detail: 'Save the current Windows desktop as a workspace', icon: <AppWindow size={15}/>, run: onCapture }, { label: 'Create developer workspace', detail: 'Import and configure a local project', icon: <Plus size={16}/>, run: onCreate }, { label: 'Stop current workspace', detail: 'Stop processes started by DevLaunch', icon: <Square size={14}/>, run: onStop }, { label: 'Open settings', detail: 'Startup, tray, and browser preferences', icon: <Settings size={15}/>, run: onSettings }]
  const items = [...matches.map((workspace: Workspace) => () => onLaunch(workspace)), ...actions.map((item) => item.run)]
  return <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}><section className="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(items.length - 1, index + 1)) } if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) } if (event.key === 'Enter') { event.preventDefault(); items[active]?.() } }}><label><Search size={18}/><input ref={input} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} placeholder="Type a command or workspace…"/><kbd>ESC</kbd></label><div className="palette-list"><p>WORKSPACES</p>{matches.map((workspace: Workspace, index: number) => <button className={active === index ? 'active' : ''} key={workspace.id} onMouseEnter={() => setActive(index)} onClick={() => onLaunch(workspace)}><span><Play size={15} fill="currentColor"/></span><div><strong>Launch {workspace.name}</strong><small>{workspace.framework}</small></div><kbd>↵</kbd></button>)}<p>ACTIONS</p>{actions.map((item, index) => { const itemIndex = matches.length + index; return <button className={active === itemIndex ? 'active' : ''} key={item.label} onMouseEnter={() => setActive(itemIndex)} onClick={item.run}><span>{item.icon}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></button> })}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span></footer></section></div>
}

export default App
