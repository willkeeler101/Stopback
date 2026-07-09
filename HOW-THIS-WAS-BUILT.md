# How StopBack Was Built — The Full Process

*A breakdown of the journey from empty folder to deployed multi-user app,
and the tools that made it possible. Written so someone else could follow
the same path.*

## The process: start dumb, ship constantly

StopBack did not start as a cloud app. It started as three plain files —
`index.html`, `style.css`, `app.js` — that saved everything to the browser's
built-in storage (`localStorage`) on one laptop. That decision mattered more
than any technology choice that came later: because version one had no
accounts, no database, and no server, there was a working, usable app on day
one, and every day after that was spent improving something real instead of
configuring something theoretical. The features were layered on in small
passes — the logging screen, then stats, then a social-style feed, then
gamification (goals, streaks, XP, badges, celebrations) — and each pass was
tested by actually using the app before moving to the next. When a feature
idea felt fuzzy, the answer wasn't to guess: we researched what proven apps
in the same space (SalesRabbit, SPOTIO) actually do, wrote the findings into
a design-notes file, and built against evidence. The single most important
habit was **working in small, testable increments**: plan, build one piece,
test it in the browser, commit it, repeat. When something broke — and things
broke constantly — the small steps meant the breakage was always in the last
thing touched.

## Git and GitHub: the safety net and the portfolio

**Git** is version control — a running series of snapshots ("commits") of the
entire project. We initialized it the day the app first felt real
(`git init`, `git add -A`, `git commit`), and from then on every feature
landed as its own commit with a message describing what changed and why.
That gave us two superpowers: the ability to experiment fearlessly (any
mistake could be rolled back to the last snapshot), and for bigger risky
work — like the cloud migration — **branches**: a parallel copy of the
project where the changes lived until they were proven, then got merged back
into `master`. **GitHub** is the online home for that git history. Pushing
the repo to GitHub (`git push`) did three jobs at once: it backed the code
up off the laptop, it created a public portfolio page where anyone can read
the code and the commit-by-commit story of how it was built, and it became
the hook that deployment hangs off of. One practical lesson: secrets never
go in the repo. The config file holding project keys was excluded via
`.gitignore` from the very first commit that needed it.

## Supabase: how a solo static site becomes a real multi-user app

The biggest single leap was replacing `localStorage` with **Supabase** —
a free-tier service that bundles the two hard parts of "real apps":
**authentication** (sign-up/sign-in with email + password, sessions,
password handling — all managed for you) and a genuine **Postgres SQL
database** in the cloud. The workflow: you design tables (ours were
`profiles`, `leads`, `log_events`, `products`, `friendships`) as SQL files,
paste them into Supabase's SQL Editor, and run them once — we kept every
migration as a numbered file in the repo (`1-core-tables…`, `2-friends…`)
so the database's history is as traceable as the code's. The concept that
makes multi-user safe is **Row-Level Security (RLS)**: rules attached to
each table, enforced by the database itself, that say "a user can only ever
read or write rows where `user_id` equals their own id." That means even if
the app's JavaScript had a bug, one rep could never see another rep's
customer list. Friend features were built on top of that with controlled
"windows" (SQL functions) that expose only aggregate stats — never raw
leads or phone numbers — and only to accepted friends who've left sharing
on. The browser talks to all of this through Supabase's JavaScript client
using a **publishable key** that is safe to expose precisely because RLS is
the real lock. Two hard-won gotchas: auth cannot run from a file opened by
double-click (`file://`) — the app must be served over HTTP, so we ran a
tiny local server during development — and "email confirmation" defaults
to on, which will silently strand test accounts until you disable it or
handle it.

## Netlify: putting it on the internet (and your phone)

**Netlify** is static-site hosting that plugs directly into GitHub. You sign
in with GitHub, point it at the repo, and from then on **every `git push`
automatically deploys the new version to a public URL** — that's a real
CI/CD pipeline, for free, with zero servers to manage. The one puzzle worth
understanding is secrets: since the keys file was gitignored, the deployed
site wouldn't have it — so a small `netlify.toml` file tells Netlify to
*generate* the config file at build time from **environment variables** set
in Netlify's dashboard. Keys stay out of the public repo; the live site
still gets them. The last wiring step is telling Supabase about the new
address (Authentication → URL Configuration → Site URL) so sign-ins from
the live domain are trusted. And because the app was mobile-first from day
one, "shipping to phones" required no app store at all: Safari's **Add to
Home Screen** installs the web app behind a real branded icon
(`apple-touch-icon`), full-screen, indistinguishable from a native app for
daily use — free, instant, and no $99 developer account or review process.

## The recipe, if you're teaching someone else

1. **Build the dumbest working version first**: HTML/CSS/JS in a folder,
   data in `localStorage`, opened in a browser. No frameworks, no build
   tools. Get someone using it (yourself counts) immediately.
2. **Adopt git the day it feels real.** Commit small and often; write
   messages your future self can read; branch for risky work.
3. **Push to GitHub early.** It's your backup, your portfolio, and the
   foundation deployment builds on. Gitignore secrets from day one.
4. **When you need accounts or multi-device data, reach for Supabase.**
   Learn three ideas: tables (SQL you run once, saved as numbered files),
   auth (they handle it), and RLS (the database enforces who sees what).
   Serve the app over HTTP locally, not `file://`.
5. **Deploy with Netlify connected to the GitHub repo.** Env vars for
   keys, `netlify.toml` to inject them at build, Supabase Site URL updated.
   From then on, `git push` = live update.
6. **Install via Add to Home Screen** — a branded icon and a phone-first
   layout make it feel native without an app store.

The meta-lesson: none of these tools were learned in the abstract. Each one
was pulled in at the exact moment the project couldn't grow without it —
git when losing work became scary, Supabase when one browser wasn't enough,
Netlify when the field needed access. That's the teachable order, because
it's the order the *need* arrives in.
