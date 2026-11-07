# Handoff

## Done

- Branch `feature/project-presets` (not committed yet): Preset menu with
  "Used in this project" and saved presets, Save as preset with a name field,
  Update, Rename and Delete for saved presets, and Minimize. Logic in `plugin/hooks/lists.ts`, tests in
  `plugin/tests/lists.test.ts`, panel in `plugin/hooks/register.tsx`.
- Validate passes, tsc is clean; 15 tests pass, the one failure is the known harness one.

## In progress

- Not yet checked in the desktop app. The installed copy reads this folder,
  so a new desktop session runs the branch's code.

## Next steps

1. After `/reload-plugins` or a fresh desktop session: pick "Used in this
   project", Apply at This project; Save, Update, Rename and Delete a
   preset; Minimize, check the toast, and that /session-kit brings it back.
2. Commit on the branch, then merge to main or drop it.
3. Still open from before: confirm a This project save of skills, and the
   public or private decision for GitHub.
