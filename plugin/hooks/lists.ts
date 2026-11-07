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
