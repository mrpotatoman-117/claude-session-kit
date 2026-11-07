// Pure rules with no engine calls, kept apart so tests can run them directly:
// trimming the lists Claude reads, and editing a settings object.

type Json = Record<string, any>

// Cuts hidden items out of a list Claude reads. Entries start with "- name:"
// and may run onto further lines; the header before them is kept.
export function dropEntries(text: string, isHidden: (name: string) => boolean) {
  let dropping = false
  return text
    .split('\n')
    .filter(line => {
      if (line.startsWith('- ')) dropping = isHidden(line.slice(2).split(': ')[0] ?? '')
      else if (line.trim() === '') dropping = false
      return !dropping
    })
    .join('\n')
}

// A plugin's tool-server notes come as "## plugin:<name>:<server>" sections.
export function dropSections(text: string, plugins: string[]) {
  return text
    .split(/\n(?=## )/)
    .filter(block => !plugins.some(p => block.startsWith(`## plugin:${p}:`)))
    .join('\n')
}

// Whether text names a plugin's namespace ("superpowers:..."), as a word of
// its own: hiding "data" must not catch "metadata:".
export function mentionsPlugin(text: string, plugin: string) {
  const name = plugin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w-])${name}:`).test(text)
}

// Sets (or, with undefined, removes) entries in one field of a settings
// object, keeping every other key and entry as it was.
export function setEntries(settings: Json, field: string, entries: Record<string, unknown>) {
  const next = { ...(settings[field] ?? {}) }
  for (const [id, value] of Object.entries(entries)) {
    if (value === undefined) delete next[id]
    else next[id] = value
  }
  return { ...settings, [field]: next }
}

// MCP servers -------------------------------------------------------------

// The prefix every tool of a server carries: "claude.ai Canva" becomes
// "mcp__claude_ai_Canva__", as Claude Code names them.
export function mcpPrefix(server: string) {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}__`
}

// Cuts a server's tools out of a tool list, one name per line.
export function dropTools(text: string, servers: string[]) {
  const prefixes = servers.map(mcpPrefix)
  return text
    .split('\n')
    .filter(line => !prefixes.some(p => line.trim().startsWith(p)))
    .join('\n')
}

// Server names from `claude mcp list` ("name: url - status"). Servers a plugin
// brings ("plugin:...") are left out: their plugin's switch controls them.
export function parseMcpList(stdout: string) {
  return stdout
    .split('\n')
    .map(line => line.match(/^(.+?): /)?.[1]?.trim() ?? '')
    .filter(name => name && !name.startsWith('plugin:') && !name.startsWith('Checking'))
}

// Adds servers to, or removes them from, a settings object's deniedMcpServers
// list, keeping every other entry and key.
export function setDenied(settings: Json, servers: string[], denied: boolean) {
  const list: { serverName?: string }[] = settings.deniedMcpServers ?? []
  const rest = list.filter(entry => !servers.includes(entry.serverName ?? ''))
  return { ...settings, deniedMcpServers: denied ? [...rest, ...servers.map(serverName => ({ serverName }))] : rest }
}

// A server's own notes come as a "## <server name>" section.
export function dropNamedSections(text: string, names: string[]) {
  return text
    .split(/\n(?=## )/)
    .filter(block => !names.some(n => block.split('\n')[0] === `## ${n}`))
    .join('\n')
}

// Presets ------------------------------------------------------------------

// A preset maps `${kind}:${id}` to whether the item should be on, the same
// shape as the panel's staged presses.
export type Preset = Record<string, boolean>

// The folder under ~/.claude/projects holding a project's past sessions:
// Claude Code names it after the path, every other character turned to "-".
export function historyFolder(root: string) {
  return root.replace(/[^a-zA-Z0-9]/g, '-')
}

// "Used in this project": plugins and skills the project's past sessions used
// go on, the rest off. MCP servers are left out, since tool calls to them are
// not counted, and a preset that turned them all off would break the project.
export function usedPreset(items: { key: string; kind: string; projectUses?: number }[]): Preset {
  const counted = items.filter(i => i.kind !== 'mcp' && i.projectUses !== undefined)
  if (!counted.some(i => i.projectUses! > 0)) return {}
  return Object.fromEntries(counted.map(i => [i.key, i.projectUses! > 0]))
}

// The presses that move the current switches to a preset: only items that
// exist now and would change. Items the preset does not name stay as they are.
export function presetChanges(current: Record<string, boolean>, preset: Preset): Preset {
  return Object.fromEntries(Object.entries(preset).filter(([key, on]) => key in current && current[key] !== on))
}

// The first free "Preset N", for a save the person does not rename.
export function nextPresetName(names: string[]) {
  let n = 1
  while (names.includes(`Preset ${n}`)) n++
  return `Preset ${n}`
}

// The presets file, read leniently: anything that is not a name mapped to
// on/off switches is dropped rather than failing the panel.
export function parsePresets(text: string): Record<string, Preset> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: Record<string, Preset> = {}
  for (const [name, preset] of Object.entries(data as Record<string, unknown>)) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) continue
    out[name] = Object.fromEntries(Object.entries(preset).filter(([, on]) => typeof on === 'boolean')) as Preset
  }
  return out
}

// Renames a preset, keeping its place in the list. A name another preset
// already has is refused rather than overwriting that preset.
export function renamePreset(presets: Record<string, Preset>, from: string, to: string) {
  if (!(from in presets)) throw new Error(`There is no preset named "${from}".`)
  if (to !== from && to in presets) throw new Error(`A preset named "${to}" already exists.`)
  return Object.fromEntries(Object.entries(presets).map(([name, p]) => [name === from ? to : name, p]))
}
