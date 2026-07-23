---
description: Push the current branch and open a PR with a full description
---

Push the current branch and open a pull request for it.

1. Check you are not on `master` (if you are, stop and say so).
2. Review the full diff against `master` — `git diff master...HEAD` plus the
   commit messages — so the description reflects what actually changed, not
   what you remember doing.
3. Push with `git push -u origin <branch>`.
4. Open the PR with `gh pr create`, passing the body in a heredoc. Never
   leave the body blank and never use `--web`.

Title: descriptive, sentence case, says what the change does. Not the branch
name.

Body: exactly these five sections.

```markdown
## What this adds
Numbered list. Bold the feature names. Describe what a user sees, not which
functions moved.

## Design decisions
The choices made and why — the alternatives rejected, the tradeoffs. This is
the part that is genuinely lost if it is not written down.

## Backend
The `supabase/*.sql` file this PR adds, **whether it has been run on the
shared Supabase project yet**, and confirmation that it is additive and safe
to re-run. If there is no SQL, write "No schema changes."

## Testing
What was actually verified — `node --check`, browser smoke test against real
Supabase, specific scenarios. Say what was NOT tested. Do not claim a test
that was not run.

## Files
The files touched, `(new)` on new ones.
```

The **Backend** section is the important one: this team shares one live
Supabase database, so whether a migration has already run is the first thing
a reviewer needs to know.

Do not merge the PR. Report the URL and stop.
