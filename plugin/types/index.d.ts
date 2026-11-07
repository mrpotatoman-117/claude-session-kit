export type Item = {
  kind: 'plugin' | 'skill' | 'mcp'
  // plugin id (name@marketplace), skill folder name, or MCP server name
  id: string
  // loads in sessions here, by the settings files
  on: boolean
  // true when this project's settings.local.json sets it explicitly
  isOverridden: boolean
  // always-on tokens per session, when known
  tokens?: number
  // plugin version, used to cache its token cost
  version?: string
  // what it is for, one line from its manifest or SKILL.md
  about: string
  // past sessions that used it (a skill, command or agent of it), when counted
  uses?: number
}

export type Sort = 'name' | 'cost' | 'used' | 'unused' | 'on' | 'off'

// Where a press applies: hidden from this session only, saved for this
// project, or saved for every project.
export type Scope = 'session' | 'project' | 'global'

export type Kit = {
  root: string
  items: Item[]
  status: string
  sort: Sort
  scope: Scope
  // which list the pane shows
  tab: Item['kind']
  // `${kind}:${id}` of items hidden from Claude for this session only
  hidden: string[]
  // presses not yet applied: `${kind}:${id}` to the state asked for
  pending: Record<string, boolean>
  // the first message has gone to Claude; the session's lists are fixed
  isStarted: boolean
  // the first message, refused and kept until Apply and start sends it
  held: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-kit': { kit: Shaped<Kit> }
  }
}
