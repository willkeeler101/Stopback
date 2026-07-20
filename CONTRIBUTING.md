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

On GitHub: "Compare & pull request" → describe what changed → open PR.
Get at least a quick look-over from another contributor before merging —
don't merge your own PR solo.

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
`supabase/` (name it `N-description-RUN-ME.sql`, next number in sequence)
and include it in your PR like normal code — but **do not run it in the SQL
Editor yourself.** Flag it in the PR so it gets run together, then rename it
to `...-ALREADY-RUN.sql` once applied. Migrations should stay additive
(`if not exists`) and never destructive.

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

## More context

See [CLAUDE.md](CLAUDE.md) for the app's architecture and coding rules,
[ROADMAP.md](ROADMAP.md) for what's planned, and
[DESIGN-NOTES.md](DESIGN-NOTES.md) for the UX research behind decisions.
