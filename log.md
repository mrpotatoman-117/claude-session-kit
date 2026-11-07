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
