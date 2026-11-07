# Log

## 2026-11-07

- Built Session kit as a desktop mod in a workspace-root session, then moved it
  here as its own project so it can be published under MIT.
- Chose a staged Apply over saving on every press, because the first test
  showed changes landing where the user did not expect.
- The first message is refused and resent (as cache-tax refuses a cold send),
  because the session's lists go out with that request and a mod can only
  trim them before then.
- Saves read the project folder at Apply time and refuse `~/.claude/spares/`,
  because the desktop app starts sessions in a spare folder and an early
  "All off" was written there.
- MCP servers are turned off through `deniedMcpServers`, tested to remove a
  server's tools; claude.ai connectors in the desktop app are pointed to the
  app's own Connectors menu, since they run under ids the deny list misses.
- Kept auto-resend after Apply and start at the user's choice, knowing the
  resent message may skip the loadable-tool list.

## 2026-11-08

- Built per-project presets and a Minimize button on branch
  `feature/project-presets`, kept off main as a test of the feature.
- Presets are the same shape as staged presses (`kind:id` to on/off), so
  choosing one only stages; the scope and Apply flow stay as they were.
- "Used in this project" counts only this project's history folder and leaves
  MCP servers out, because MCP tool calls are not counted and turning every
  server off would break the project.
- Naming is a text field in the panel, since the desktop app draws one; the
  mobile app has none, so there the save takes the next "Preset N".
- Minimize is the mod's own one-row view, because the engine can only close a
  pane, and closing sends the held first message.
- Added Update, Rename and Delete for saved presets. Rename refuses a name
  another preset has rather than overwrite it; Delete asks to confirm, since
  the file keeps no history. Fixed a save leaving the menu on no preset.
- The installed mod reads from this folder, so `/reload-plugins` picks up
  edits; the copy under ~/.claude/plugins/cache is stale and unused.
- Minimize now closes the pane and draws a one-row band above the prompt,
  because a docked pane keeps the size the app gives it and folding its
  contents left the frame full height. Closing by Minimize keeps a held first
  message held, unlike closing by hand.
- Update, Rename and Delete sat in a column: a JSX fragment inside a row is
  drawn as its own column in the desktop app, so the buttons are an array.
- The above-prompt band did not show in the desktop app, leaving no visible
  way back, so it was removed. Minimize now closes the pane with a toast
  naming /session-kit, is not kept across sessions (a new session would
  start with no panel), and a held first message reopens the pane.
- Pushed feature/project-presets (0.2.0) and kept it off main for more
  testing. Released v0.1.0 from main as the stable release and v0.2.0 from
  the branch as a pre-release. A test presets file was pushed by mistake in
  the first branch commit; it is now gitignored but stays in that commit.
