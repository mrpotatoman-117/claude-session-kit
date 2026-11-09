# Handoff

## Done

- Branch `feature/project-presets` (pushed; v0.2.1 pre-release covers presets
  and Minimize only): Preset menu with "Used in this project" and saved
  presets shared across projects, Minimize, search, the project's own skills
  (`.claude/skills`) and MCP servers (`claude mcp list` run in the project),
  and skill families grouped from `~/.agents/.skill-lock.json` and the
  project's `skills-lock.json`. Logic in `plugin/hooks/lists.ts`, tests in
  `plugin/tests/lists.test.ts`, panel in `plugin/hooks/register.tsx`.
- Validate passes, tsc is clean; 18 tests pass, the one failure is the known harness one.
- Ponytail audit delivered in chat; its eight findings are not fixed.

## In progress

- Families and project skills not yet checked in the desktop app.

## Next steps

1. `/reload-plugins`, open the Skills tab: check the taste-skill and
   hyperframes families' switch and Show, and in Focus-Groov the bama and
   macos-app-skills families and the REA server (it needs approving there).
2. Decide which audit findings to fix (numbered 1 to 8 in `log.md`'s audit
   entry or the chat).
3. Merge the branch into main, then drop the pre-release mark on GitHub, or
   cut v0.2.2 first if the families should ship as a pre-release.
