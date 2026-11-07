# Session kit

A Claude Code mod, published under MIT, that lets a person choose which
plugins, skills and MCP servers load for one session, one project or all
projects. The repository root is a plugin marketplace; the mod lives in
`plugin/`. `README.md` says what it does and maps the tree.

## How work is done here

- Edit the mod in `plugin/` only, because this folder is the one source: the
  installed copy is read from here, and a second copy drifts.
- Before calling a change done, run `claude plugin validate plugin` and
  `claude plugin test plugin`, because the engine refuses a module the
  validator flags and the tests cover the parts that edit settings files.
- New pure logic (parsing, list trimming, settings edits) goes in
  `plugin/hooks/lists.ts` with a test in `plugin/tests/lists.test.ts`, because
  those rules are the ones that can damage a user's settings.
- Check a change in the desktop app, not only in `claude -p`, because the app
  starts sessions in spare folders before a window attaches and `-p` never
  shows the panel.
- After an install change, the first new desktop session may still run the
  previous version, since the app prepares a spare session in advance.
- `plugin/trace.log` records start-up, first-message and save decisions;
  read it first when a save seems to do nothing.
