import type { WorkspaceCommand } from '../../shared/types'

export function expandCommandDependencies(commands: WorkspaceCommand[], selectedIds: Set<string>) {
  const byId = new Map(commands.map((command) => [command.id, command]))
  const expanded = new Set(selectedIds)
  const visit = (id: string, chain: string[]) => {
    const command = byId.get(id)
    if (!command) throw new Error(`Command dependency not found: ${id}`)
    if (chain.includes(id)) throw new Error(`Command dependency cycle: ${[...chain, id].join(' → ')}`)
    for (const dependency of command.dependsOn || []) {
      expanded.add(dependency)
      visit(dependency, [...chain, id])
    }
  }
  for (const id of [...selectedIds]) visit(id, [])
  return expanded
}

export function planCommands(commands: WorkspaceCommand[], selectedIds?: Set<string>) {
  const included = expandCommandDependencies(commands, selectedIds || new Set(commands.filter((item) => item.runOnLaunch).map((item) => item.id)))
  const byId = new Map(commands.map((command) => [command.id, command]))
  const visiting = new Set<string>(); const visited = new Set<string>(); const result: WorkspaceCommand[] = []
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Command dependency cycle detected at ${byId.get(id)?.name || id}`)
    const command = byId.get(id)
    if (!command) throw new Error(`Command dependency not found: ${id}`)
    visiting.add(id)
    for (const dependency of command.dependsOn || []) if (included.has(dependency)) visit(dependency)
    visiting.delete(id); visited.add(id); result.push(command)
  }
  for (const command of commands.filter((item) => included.has(item.id)).sort((a, b) => a.order - b.order)) visit(command.id)
  return result
}
