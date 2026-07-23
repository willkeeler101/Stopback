# Contributing to StopBack

Multiple people now work on this repo against a **shared Supabase backend**.
Follow this workflow every time so we don't overwrite each other's work or
break the live database.

## One-time setup (new contributor)

1. Clone the repo.
2. Copy `config.example.js` → `config.js` and fill in the Supabase Project
   URL + anon key (get these from Will — same shared project, everyone uses
   the same keys). The anon key is safe in the browser; RLS protects data.
3. Copy or recreate `serve.ps1` (or use any static file server) to run
   locally over `http://` — Supabase Auth does not work over `file://`.
4. Sign up in the app as yourself — RLS means everyone sees only their own
   leads unless you friend each other in-app.

## Before starting ANY work

```bash
git checkout master
git pull
```

Always start from the latest `master`. Don't build on stale code.

## Start a branch for your task

```bash
git checkout -b yourname/short-feature-name
```

e.g. `sarah/map-view`, `will/smarter-hitlist`. One branch per feature/fix.
**Never commit directly to `master`.**

## Do the work

Use Claude Code as normal on your branch. Commit as you go:

```bash
git add -A
git commit -m "short description of what changed"
```

## Push your branch

```bash
git push -u origin yourname/short-feature-name
```

## Open a Pull Request

Open it from the terminal with `gh` and **write the body in the command** —
don't open it in the browser and don't leave the description blank:

```bash
gh pr create --title "Descriptive title, not the branch name" --body "$(cat <<'EOF'
## What this adds
...
EOF
)"
```

Get at least a quick look-over from another contributor before merging —
don't merge your own PR solo.

### What goes in the body

The PR description is how the rest of us find out what changed without
reading the diff — and it's the only record of *why* once the branch is
gone. Every PR gets these five sections:

| Section | What it answers |
| --- | --- |
| **What this adds** | Numbered list, feature names bolded — what a user actually sees, not which functions moved. |
| **Design decisions** | The choices you made and the reasoning. This is the part that's genuinely gone if you skip it. |
| **Backend** | Any `supabase/*.sql` file: which one, **whether it's been run on the shared DB**, and that it's additive/safe to re-run. Write "none" if there's no SQL. |
| **Testing** | What you actually verified — browser smoke test, `node --check`, which scenarios. What you *didn't* test counts too. |
| **Files** | The files touched, new ones marked `(new)`. |

The **Backend** section is the one that matters most here — we share one
live database, so "migration 7 is in this PR and has NOT been run yet" is
the single most important line a reviewer can read. See PRs
[#2](../../pull/2) and [#4](../../pull/4) for the shape.

### Telling Claude Code to do it

Claude reads this file, so on your branch it's usually enough to say:

> Push the branch and open the PR with `gh pr create`, following the PR
> conventions in CONTRIBUTING.md.

If it still gives you a one-liner, spell it out: *"write the full body in a
heredoc — What this adds / Design decisions / Backend / Testing / Files —
and use a descriptive title, not the branch name."* A title like
`Will/map view` is a tell that the PR was opened in the GitHub UI rather
than with `gh`.

## After a PR is merged (yours or theirs)

```bash
git checkout master
git pull
```

Do this before starting your next branch, every time.

---

## ⚠️ Database/SQL changes are different — read this

We share **one live Supabase database**. Code changes are safe — branches
and PRs protect us. SQL changes are **not** — anything pasted into the
Supabase SQL Editor runs immediately against the real, shared data.

**Rule:** if a feature needs a new table/column, add a new file to
`supabase/` and include it in your PR like normal code — but **do not run it
in the SQL Editor yourself.** Flag it in the PR so it gets run together, then
rename it to `...-ALREADY-RUN.sql` once applied. Migrations should stay
additive (`if not exists`) and never destructive.

**Naming:** `N-yourname-description-RUN-ME.sql` — next number in sequence,
**plus your first name** (e.g. `6-will-lead-coordinates-RUN-ME.sql`). The name
prefix means that even if two people grab the same number on parallel
branches, the files never collide when the branches merge.

## If you hit a merge conflict

Git marks conflicting spots like this:

```
<<<<<<< HEAD
your version
=======
their version
>>>>>>> their-branch
```

Don't guess — bring the file to Claude Code and ask it to help resolve the
conflict, or ask Will.

## Golden rules

1. Pull `master` before you branch. Pull `master` after every merge.
2. Never commit straight to `master`.
3. Never run a SQL migration solo — coordinate first.
4. Small, frequent PRs beat one giant branch after two weeks.
5. Never open a PR with an empty description — five sections, every time.

## More context

See [CLAUDE.md](CLAUDE.md) for the app's architecture and coding rules,
[ROADMAP.md](ROADMAP.md) for what's planned, and
[DESIGN-NOTES.md](DESIGN-NOTES.md) for the UX research behind decisions.
