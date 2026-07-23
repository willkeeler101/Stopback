# StopBack — Build Roadmap

A door-to-door sales tracker. ~1 hour/day, ~2 weeks. Check things off as you go.

> 📚 See [DESIGN-NOTES.md](DESIGN-NOTES.md) for research-backed best practices
> (from SalesRabbit, SPOTIO, and UX studies) guiding these decisions.

## Research-backed backlog (top 10 — see DESIGN-NOTES for the "why")
1. ~~**Map view of houses**~~ ✅ v1+v2 DONE (GPS-tagged pins, clustering, smart markers, filters, bottom-sheet actions) — knock history/heatmap phases in [MAP-ARCHITECTURE.md](MAP-ARCHITECTURE.md)
2. **One-tap door disposition** — log every knock (not home / no / callback / sale), not just stop backs
3. **True offline PWA** — installable on home screen, works with zero signal, bundled fonts
4. **Faster entry** — voice-to-text notes + address autocomplete to fight slow data entry (the #1 reason reps quit apps)
5. ~~**Daily goal progress ring** on the Feed~~ ✅ DONE
6. **Lead score / smarter Hit List** — auto-rank stop backs by demeanor + recency + due callback
7. **Follow-up cadence** — "last contacted" timestamp + auto nudges (Day 1 / 3 / 7)
8. ~~**Badges & milestones**~~ ✅ DONE (XP + levels, badges, confetti, streak-at-risk card)
9. ~~**CSV/Excel export** of leads~~ ✅ DONE (Profile → Backup → Export leads to CSV)
10. **Leaderboard done right** (cloud) — tiered groups + personal-best framing, not one global rank

## ✅ Feed redesign — premium production pass (DONE, July 2026)
- [x] One-font typography system (Inter everywhere; Fraunces retired; `--fs-*` token scale)
- [x] Segmented feed header: **For You | \<active team\>** (TikTok-style, multi-team ready)
- [x] Twin SALES rings: Today vs daily goal + This Week (Mon–Sun) vs weekly goal
      (`profiles.weekly_sales_goal`, migration 8; blank = 6× daily fallback)
- [x] Weekly gold celebration (once per week, reload-safe, seeded silently)
- [x] Team Hub pane: identity card, team leaderboard (moved out of For You), coming-soon tiles
- [x] Density/polish pass: tighter rhythm, 40px+ tap targets, less filler copy

### Team Hub backlog (the coming-soon tiles, in rough order)
- [ ] Team chat
- [ ] Team announcements (owner posts, members read)
- [ ] Shared team goals
- [ ] Live territory map (friend layer — see MAP-ARCHITECTURE.md Phase C)
- [ ] Team achievements
- [ ] Team stats

## ✅ Phase 3.5 — "For You" feed + Friends (DONE)
- [x] Scrollable For You feed (Instagram-style stream of cards)
- [x] AI Coach cards (heuristic): pace-to-goal, demeanor approach tips, money pattern, cold leads, daily objection drill
- [x] Callbacks Due + Today's Hit List as feed cards
- [x] Your highlights (streak, sales, record day) with 🔥 reactions
- [x] Friends system: add/remove friends, friend highlight cards in feed (sample data until cloud)
- [x] Daily goal progress ring at top of feed
- [ ] Later: plug the AI Coach into the real Claude API (ties to Anthropic coursework)

## ✅ Phase 1 — Core tracker (DONE)
- [x] Four counters: Contacts, Stop Backs, Missed Closings, Sales
- [x] Quick "+1 contact" tally for people you talk to without getting a number
- [x] Add Stop Back form: name, phone, address, demeanor, notes
- [x] Leads list with Call / Text / Missed / Sale / Delete
- [x] Live stats: funnel + conversion rates
- [x] Saves on the device (localStorage) + backup export/import

## ✅ Phase 1.5 — Redesign + Feed/Profile v1 (DONE)
- [x] Papyrus theme: parchment bg, ink text, forest green (stop backs/sales), dark red (missed)
- [x] Signature display font (Fraunces) for headings + Inter for body
- [x] 5-item bottom nav with bubble icons (Feed · Leads · Log[center] · Stats · Profile)
- [x] Fun Stats page: highlight cards, colored funnel bars, conversion rates
- [x] **Feed v1**: greeting, streak, daily rotating Hit List (call/text/in-person), weekly recap, records
- [x] **Profile**: rep name, daily goal, lifetime stats, backup

## Phase 2 — Leads polish + import past stats
- [x] Import/seed past stats (baseline contacts, stop backs, missed, sales from before the app)
- [x] Edit an existing lead (modal: name, phone, address, demeanor, notes, callback)
- [x] "Mark callback" with a reminder date → shows in Feed "Callbacks Due" + lead badge
- [ ] Sort leads (newest, demeanor, status)
- [ ] Tag the neighborhood / area for each lead

## Phase 3 — Product catalog
- [x] A "Products" view (opened from Profile) to add what you sell
- [x] Each product: name, price, key features (one per line)
- [x] Edit / delete products
- [x] Products saved like leads (localStorage + included in backup)
- [ ] Optional product photo (deferred — needs image handling to avoid storage bloat)

## Phase 4 — Brochure generator
- [ ] A printable brochure page built from your product catalog
- [ ] Clean print layout (laminate-friendly)
- [ ] Pick which products appear, reorder them

## Phase 5 — Max it out
- [ ] Make it installable on your phone's home screen (PWA + offline)
- [ ] Daily / weekly goals with progress
- [ ] Charts (sales over time, demeanor breakdown)
- [ ] Polish, screenshots, and a strong README for your resume

## Feed — the big vision (grow over time)
The Feed is StopBack's home screen, AI coach, and social hub. People love watching themselves win.

### ✅ For You feed v2 (DONE)
- [x] Scrollable "For You" stream of mixed post cards (Instagram-style)
- [x] AI Coach posts (heuristic): goal pace, demeanor-based approach tips, "money pattern" (best-converting demeanor), going-cold leads, daily objection drill, motivation
- [x] Callbacks Due + Today's Hit List folded in as feed posts
- [x] Your highlight cards (streak, sales milestones, record day) with 🔥 reactions
- [x] Friends system: add/remove friends (Profile → Manage Friends), friend highlight cards in the feed, 2 demo friends seeded
- [x] Weekly recap post (last 7 days)

### Still to grow
- [ ] **Real friend sync** — friends' stats are SAMPLE data; live sharing needs the cloud/accounts phase
- [ ] **Swap heuristic coach for the real Claude API** (great Anthropic tie-in)
- [ ] Best-time-to-knock / best-time-to-call suggestions
- [ ] Badges & milestones (first sale, 10-day streak, 100 contacts)
- [ ] Daily goal progress ring tied to the Profile goal
- [ ] Trend vs last week ("+3 sales 🔥")

## Stretch ideas (optional)
- [ ] Map view of houses you've hit
- [ ] Cloud sync across phone + laptop (accounts)
- [ ] Export leads to CSV
