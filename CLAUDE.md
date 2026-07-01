# CLAUDE.md — StopBack

Context for future sessions working on this app. Read this first.

## What StopBack is
**StopBack** is a door-to-door (D2D) sales tracker built for Verizon field reps
(the maintainer sells Verizon wireless + home internet door-to-door). It runs on
the rep's phone in the field and on a laptop for review.

A **"stop back"** is the core concept: a prospect who said *"come back later"* —
i.e., the rep got their **phone number** to follow up. Stop backs are the leads
the whole app revolves around.

The sales funnel the app tracks: **Contacts → Stop Backs → Sales**, with
**Missed Closings** as the negative branch.

## Tabs (bottom nav, 5 items)
- **Feed** — a "For You" page: an AI sales coach (currently heuristic/rule-based,
  not a real LLM) plus a scrollable stream of cards — coaching tips, callbacks
  due, today's hit list, your highlights, and friends' highlights.
- **Leads** — searchable list of every stop back; edit / call / text / mark
  missed or sale / set a callback date.
- **Log** (center, larger button) — the fast field-entry screen: four live
  counters, a one-tap "+1 contact" tally, and the Add Stop Back form.
- **Stats** — funnel bars + conversion rates (stop-back rate, close rate, sales/contact).
- **Profile** — rep name, daily goal, import past stats, lifetime totals,
  Friends and Products sub-screens, backup (JSON) + CSV export.

## Current tech
- **No build step, no framework.** Plain HTML + CSS + vanilla JS.
- **File structure (3 files — NOT a single file):**
  - `index.html` — all markup / views
  - `style.css` — all styling (design tokens are CSS variables in `:root`)
  - `app.js` — all logic
- Fonts load from Google Fonts (Fraunces + Inter) with system fallbacks when offline.
- **All data is stored in the browser via `localStorage`.** No server, no accounts.

## Data model
Everything lives under **one localStorage key**:

### Key: `stopback-data-v1`
Holds a single JSON object (the whole `state`). Shape:

```js
{
  contactsTally: 0,        // number — people talked to but no number gotten
  leads: [Lead],           // array of stop-back records (see below)
  activeDays: ["2026-07-01"], // array of "YYYY-MM-DD" strings; drives streaks
  profile: { name: "", dailyGoal: 5 },  // name: string, dailyGoal: number
  baseline: {              // "import past stats" — added ON TOP of live counts
    contacts: 0, stopbacks: 0, missed: 0, sales: 0   // all numbers
  },
  products: [Product],     // things the rep sells (for the future brochure)
  friends: [Friend],       // friends added to share highlights with
  likes: { "like:<postId>": true }  // map of feed posts the rep reacted to
}
```

### Lead
```js
{
  id: 1719800000000,       // number — Date.now() at creation (also the key)
  name: "John Smith",
  phone: "(555) 123-4567",
  address: "123 Maple St", // may be ""
  interest: "Interested",  // one-tap chip: Interested | Maybe | Unlikely | "" (primary tag now)
  demeanor: "",            // LEGACY (old leads): Friendly | Interested | Neutral | Skeptical | Hostile
  notes: "",
  callback: "",            // "" or a "YYYY-MM-DD" date the rep should follow up
  status: "stopback",      // one of: stopback | missed | sale
  createdAt: "2026-07-01T..." // ISO string
}
```

### Product
```js
{
  id: 1719800000000,       // number — Date.now()
  name: "Verizon Home Internet",
  price: "$50/mo",         // free-text string
  features: "Unlimited data\nNo contract", // one feature per line (\n-separated)
  createdAt: "2026-07-01T..."
}
```

### Friend
```js
{
  id: "f1719800000000",    // string — "f" + Date.now()
  name: "Marcus T."
}
```
Note: two **demo friends** (`DEMO_FRIENDS` in `app.js`) always appear in the feed
as sample data — they are constants in code, NOT stored in `state.friends`.
Friend highlight stats are currently **generated sample data** (real cross-user
sharing needs the future cloud phase).

### Derived totals (not stored — computed in `app.js`)
Counters shown around the app fold in the `baseline` (imported) numbers:
- `contactsTotal = baseline.contacts + contactsTally + leads.length`
- `stopbacksTotal = baseline.stopbacks + leads.length`
- `missedTotal = baseline.missed + (leads with status "missed")`
- `salesTotal = baseline.sales + (leads with status "sale")`

## Design language
Keep this aesthetic in ALL future work — it's the brand.
- **Background:** warm cream / papyrus (`--paper: #f2e8d2`), with slightly darker
  cream surfaces (`--paper-2: #ece0c4`, `--paper-3: #e4d6b6`).
- **Text:** warm near-black ink (`--ink: #211c16`), muted (`--ink-soft: #6b6253`).
- **Accent:** deep forest green (`--green: #2f6b43`, `--green-deep: #234f33`) —
  used for **stop backs and sales** (the wins).
- **Negative accent:** dark red (`--red: #9b2226`) — used for **missed closings**.
- **Headers/subheaders:** serif display font **Fraunces** (the signature look).
- **Body text:** **Inter** (clean, readable).
- Design tokens live as CSS variables in `:root` in `style.css` — reuse them,
  don't hardcode new colors.

## Coding rules (do not break these)
1. **Mobile-first.** Reps use this one-handed on a phone in the field. Design for
   the phone first; make sure it still works on a laptop.
2. **Large tap targets.** Some reps are older / low-tech. Buttons and inputs must
   be big and easy to hit; keep generous padding and spacing.
3. **Never wipe existing localStorage on changes.** When adding fields, merge with
   defaults (see `load()`), keep the `stopback-data-v1` key, and preserve the
   user's saved leads/products/friends. Existing users must not lose data.
4. **Keep it lightweight / no build step for now.** Currently 3 files
   (`index.html`, `style.css`, `app.js`), vanilla JS, no framework, no bundler.
   (The maintainer's stated intent is "single-file" simplicity — see open
   question below before restructuring.)
5. **Never add friction to logging.** Fast field entry is the #1 thing that makes
   reps keep using a sales app (see `DESIGN-NOTES.md`). Guard the Log flow.

## More context
- `ROADMAP.md` — what's done and what's next (phases + research-backed backlog).
- `DESIGN-NOTES.md` — best practices from SalesRabbit/SPOTIO + UX research.

## Open question for the maintainer
The brief described this as "single-file index.html," but it's currently **3
separate files**. Confirm whether to (a) keep the 3-file structure, or
(b) consolidate CSS + JS inline into one `index.html`. This doc will be updated
to match whichever you choose.
