# CLAUDE.md — StopBack

Context for future sessions working on this app. Read this first.

## What StopBack is
**StopBack** is a door-to-door (D2D) sales tracker built for Verizon field reps
(the maintainer sells Verizon wireless + home internet door-to-door). It runs on
the rep's phone in the field and on a laptop for review.

A **"stop back"** is the core concept: a prospect who said *"come back later"* —
i.e., the rep got their **phone number** to follow up. Stop backs are the leads
the whole app revolves around.

The funnel: **Contacts → Stop Backs → Sales**, with **Missed Closings** as the
negative branch.

## Team workflow (2-3 people, SHARED Supabase backend)
- **Before starting ANY work:** `git checkout master && git pull`, then branch.
  Never build on a stale branch — we overwrite each other otherwise.
- The Supabase project is shared by the whole team. A bad migration or
  destructive query hits everyone's data. Migrations stay additive
  (`if not exists`), follow the numbered `RUN-ME` / `ALREADY-RUN` naming, and
  get flagged to the team before running.

## Architecture (Phase 2+: Supabase is the source of truth)
- **Multi-user app**: Supabase Auth (email/password) + Postgres + RLS.
- On login, `db.js → dbLoadState()` pulls the rep's rows into the in-memory
  `state` object; every mutation writes back optimistically (UI first, then
  `db*` call with a toast on failure).
- `save()` only writes a local **cache** (`stopback-cache-v1`) + likes; the
  pre-migration blob in `stopback-data-v1` is preserved untouched for the
  still-pending one-time importer.
- **Local dev:** must run over http, not file:// (Supabase Auth breaks on
  file://). Use `serve.ps1` → http://localhost:8000. Keys live in gitignored
  `config.js` (copy `config.example.js`); the publishable/anon key is safe in
  the browser — RLS protects data. Never put secret keys in client code.

### Files
- `index.html` — all markup (auth + onboarding screens, 5 tab views, sub-views)
- `style.css` — all styling; design tokens are CSS variables in `:root`
- `app.js` — app logic, render functions, gamification, feed
- `auth.js` — auth gate + onboarding (routes: auth → onboarding → app)
- `db.js` — ALL Supabase reads/writes (`dbLoadState`, `dbAddLead`, RPCs…)
- `supabase.js` / `config.js` — client init / keys (config is gitignored)
- `supabase/*.sql` — migrations the maintainer pastes into the SQL Editor,
  named by run order: `1-core-tables…` → `2-friends-privacy…` →
  `3-callbacks-goals-teamfeed…`. Suffixes (`ALREADY-RUN` / `RUN-ME`) track
  status — when a new migration is added, name it `4-…-RUN-ME.sql` and
  rename it to `…-ALREADY-RUN.sql` once the maintainer has run it.

### Postgres tables (all RLS: owner-only unless noted)
- `profiles` — 1:1 with auth.users: username, display_name, email,
  daily_goal, **daily_sales_goal**, baseline_* (imported past stats),
  active_days (date[], streaks), gamify (jsonb), current_streak
  (denormalized for friends), share_stats / share_leads / share_phone
  (privacy toggles), imported_at.
- `leads` — the pipeline: name/phone/address/interest/notes,
  status (stopback|missed|sale), **callback_at** (timestamptz — date+time;
  legacy `callback` date column kept but unused), **sold_at** (timestamptz,
  set when marked sale; powers 2-sales-in-an-hour), created_at.
- `log_events` — one row per "+1 contact" tap (type='contact').
- `products` — the rep's catalog (future brochure).
- `friendships` — requester/addressee/status(pending|accepted|blocked);
  only the recipient can accept.
- Friend reads NEVER hit tables directly — only SECURITY DEFINER functions
  that honor privacy toggles: `search_profiles`, `get_friendships`,
  `get_friends_overview` (stats + achievement inputs for self + accepted
  friends who share_stats), `get_friend_leads` (phone gated by share_phone).

### Client `state` shape (in-memory, loaded from Supabase)
```js
{
  contactsTally,            // count of contact log_events
  leads: [{ id(uuid), name, phone, address, interest, demeanor(legacy),
            notes, callbackAt(ISO|""), soldAt(ISO|""), status, createdAt }],
  activeDays: ["YYYY-MM-DD"],
  profile: { name, dailyGoal, salesGoal },
  baseline: { contacts, stopbacks, missed, sales },  // imported past stats
  products: [{ id, name, price, features, createdAt }],
  friends: [],              // managed via RPCs, not this array
  likes: { "like:<postId>": true },   // local-only (localStorage)
  privacy: { shareStats, shareLeads, sharePhone },
  gamify: {
    badges, lastStreakCelebrated, streakSeen,
    goalHitDate,      // legacy, unused
    goalCelebrated: { stopbacks: "YYYY-MM-DD", sales: "YYYY-MM-DD" },
    // ^ date each daily goal last triggered the GOLD celebration; checked in
    //   runGamification (user actions only) and seeded silently in initGamify
    //   so page loads / re-renders can never re-celebrate.
    records: { contactsDay|stopbacksDay|salesDay|salesStreak|loginStreak|
               closeRate|bestWeek: { v, date } },   // permanent personal bests
    recordsCelebrated: { key: "YYYY-MM-DD" }        // one banner/type/day
  }
}
```
Personal records: checked in `checkRecords()` (action path only) → slim gold
"New Personal Best" banner (`recordBanner`), max one per action; history is
seeded silently on load from leads + `v_daily_stats` (`seedRecords`), which
also backfills best-contacts-day / close-rate / best-week. Close-rate record
days require ≥ `CLOSE_RATE_MIN_CONTACTS` (10) contacts. `state.contactsTodayCount`
(transient) tracks today's +1 taps for contact records/tiers.
Derived totals fold in `baseline` (see `contactsTotal()` etc.). XP/levels are
derived (`computeXP()`, effort-weighted); badges checked against live data.

## Tabs (bottom nav, 5 items)
- **Feed** — "For You": twin goal rings (stop backs + sales), streak-at-risk
  nudge, **Today's Hit List** (the feature card: due/overdue scheduled
  callbacks pinned on top with time shown, then rotating picks — who to
  text/call/stop back; **no selling advice, ever** — the maintainer removed
  the AI coach on purpose), real **achievements** for self + friends
  (from `get_friends_overview`; includes goal-reached, record-broken,
  badge-earned, passed-yesterday, contact tiers — timestamped, ≤4/person),
  **Pace card** (projected finish, ahead/behind vs a 9AM–9PM day window),
  **Insight card** (one positive friend comparison), **friends leaderboard**
  (Today/This Week/All Time tabs × Stop Backs/Sales metric, effort-first
  default, top-3 medal ranks, self-row highlighted; repaints rows in place),
  **Weekly Recognition** (live weekly award leaders, gold accents), weekly
  recap. Profile has an **Achievement Showcase** (collectible tiles; record
  tiles gold; keeps p-contacts/p-stopbacks/p-sales/p-days ids).
  Daily goals go **GOLD** when hit (metallic ring + card sheen + ~2.5s
  full-screen celebration) and the target rolls +1 forever (5/5 → 5/6 → 6/7)
  with rotating hype lines — gold never resets that day.
- **Leads** — searchable list; call/text/missed/sale/delete/edit; interest +
  callback badges. **List ⇄ Map toggle**: Leaflet territory map (CARTO/Esri
  basemaps, clustered smart pins colored by status+interest with callback
  rings, filter chips, bottom-sheet quick actions, callback-zone insight).
  Coords come from the Log form's "Tag this house" GPS button (migration 5,
  `leads.lat/lng`). Phased plan + future data models: MAP-ARCHITECTURE.md.
- **Log** (center, larger) — counters, +1 tally, Add Stop Back form
  (name/phone/address, "How'd it go?" note, one-tap interest chips,
  optional "When to come back?" datetime).
- **Stats** — Today/Week/All-time filter, tappable funnel drill-downs with
  7-day CSS trends and plain-English insights.
- **Profile** — level/XP + badges, name + BOTH daily goals, import past
  stats, lifetime, Friends + sharing toggles, Products, backup/CSV, sign out.

## Achievements (exact set, computed in `achievementsFor()`)
- Sales streak: consecutive days with ≥1 sale (from `sale_days`).
- Weekly sales milestones: 3/5/10/15/20 (`SALES_WEEK_TIERS`).
- Daily stop-back milestones: 5/10/15/20 (`SB_DAY_TIERS`).
- Hot streak: 2+ sales within an hour (real `sold_at` only; old sales
  without a timestamp don't count).
- Login streak: `current_streak` ≥ 2.

## Design language
Keep this aesthetic in ALL future work — it's the brand.
- Warm cream/papyrus bg (`--paper`), ink text (`--ink`), forest green wins
  (`--green`/`--green-deep`), dark red misses (`--red`), amber accents
  (`--amber`, sales ring).
- **Fraunces** for headers (signature look), **Inter** for body.
- Spacing/type/shadow tokens in `:root` — reuse them, don't hardcode.
- Cards: same radius/border/shadow everywhere; gentle enter animations;
  respect `prefers-reduced-motion`.

## Coding rules (do not break these)
1. **Mobile-first, one-handed.** Big tap targets (~40px+); some reps are
   older/low-tech.
2. **Never wipe or corrupt data** — client state merges defaults; SQL
   migrations are additive (`if not exists`), never destructive.
3. **Optimistic UI**: update state + render first, then persist; failures
   toast, never block logging.
4. **Never add friction to the Log flow** (see DESIGN-NOTES.md).
5. No build step, no framework, vanilla JS. Scripts load in order:
   supabase-js CDN → config → supabase → auth → db → app.
6. **No AI selling advice in the feed.** The Hit List tells the rep WHO to
   contact, not HOW to sell.

## Pending / known loose ends
- **One-time importer** (localStorage → Supabase) not built yet; the user's
  pre-migration data still sits in `stopback-data-v1` on his device.
- Leaderboard among friends (Today/Week/All-time; effort-first) planned.
- Brochure generator from Products; PWA/offline; AI coach Edge Function
  (scaffold only) — all future.

## More context
- `ROADMAP.md` — phases + research-backed backlog.
- `DESIGN-NOTES.md` — SalesRabbit/SPOTIO + UX research behind the decisions.
