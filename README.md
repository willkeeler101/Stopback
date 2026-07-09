# StopBack — Door-to-Door Sales Tracker

A multi-user, cloud-backed web app for door-to-door (D2D) sales reps. Log
every door in the field, save "stop backs" (prospects whose number you got),
schedule timed callbacks, and compete with your crew on a live team feed —
all from your phone while canvassing.

Built by a working Verizon D2D rep to run his own pipeline.

## Features

**Field logging (speed-first)**
- One-tap contact tally + a fast stop-back form (name, phone, address,
  one-tap interest chips, "when to come back" with date **and** time)
- Call / Text buttons open the phone's dialer and SMS directly

**Today's Hit List**
- The feed's centerpiece: who to text, call, or stop back today — due
  callbacks pinned first, the rest rotating daily

**Goals & motivation**
- Twin daily goal rings (stop backs + sales) that turn **gold** with a
  full-screen celebration when hit, then roll the target +1 all day
- Personal records (best day/week, streaks, close rate) with a
  "New Personal Best" banner
- XP levels (Rookie → Rainmaker), badges, streaks, and a daily pace
  indicator that projects your finish from your actual rate

**Team (multi-user)**
- Accounts with email/password auth; friend requests by username or email
- Live team feed of real achievements, a friends leaderboard
  (Today / Week / All-Time × Stop Backs / Sales), weekly recognition
  awards, and positive head-to-head insights
- Privacy-first sharing: stats/milestones only by default — raw leads and
  phone numbers are never shared unless explicitly toggled on

**Analytics**
- Drillable stats: funnel, conversion rates, 7-day trends, time filters
- CSV export (opens in Excel) + JSON backup

## Tech stack

- **Frontend:** vanilla HTML/CSS/JavaScript — no framework, no build step
- **Backend:** Supabase (Postgres + Auth) with **row-level security** so every
  rep's data is isolated at the database layer; friend access flows only
  through SECURITY DEFINER functions that honor per-user privacy toggles
- **Design:** mobile-first, warm cream/forest-green palette, serif display
  type (Fraunces) — premium and minimal, built for one-handed field use

## Run it locally

1. Clone the repo.
2. Create a free [Supabase](https://supabase.com) project and run the SQL
   files in `supabase/` (numbered, in order) via the SQL Editor.
3. Copy `config.example.js` → `config.js` and add your Project URL + publishable key.
4. Serve the folder over HTTP (any static server) and open it — auth won't
   run from a `file://` path.

## Deploying

Deploys as a plain static site (e.g. Netlify). `netlify.toml` generates
`config.js` at build time from the `SUPABASE_URL` and `SUPABASE_ANON_KEY`
environment variables, so no keys live in the repo.

## Why I built it

I do door-to-door sales and needed one place to track every contact, stop
back, and sale — and I wanted chasing the numbers to feel like a game worth
winning. I built it with Claude Code, learning full-stack fundamentals
(auth, Postgres, RLS, deployment) along the way.
