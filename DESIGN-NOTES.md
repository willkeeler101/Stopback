# StopBack — Design Notes & Research

Best practices for building a door-to-door (D2D) sales app, pulled from the
leading proven apps (SalesRabbit, SPOTIO) and UX research. Use this to guide
decisions and to talk about the project intelligently (resume / interviews).

---

## 1. What the proven D2D apps do

The two market leaders for door-to-door are **SalesRabbit** and **SPOTIO**.
Their shared, table-stakes feature set:

- **Territory & canvassing maps** — reps see neighborhoods, plan routes, and drop pins on houses.
- **Lead tracking** — record prospects, status, and follow-ups.
- **Activity tracking** — every knock, call, and meeting is logged.
- **Appointment scheduling & follow-up sequences.**
- **Offline mode** — log knocks, pins, and notes with no signal; sync later.
- **Map-based door history** — SPOTIO pins each knocked house and shows how many attempts it has had, and even how far the rep was from the door (GPS).
- **AI lead prioritization** — SalesRabbit's "DataGrid AI" gives buyer scores and prioritizes leads; residential data (homeownership, credit capacity).

**Takeaway for StopBack:** reps expect *map + offline + fast logging + follow-up*.
We already have fast logging, follow-ups (callbacks), and local/offline storage.
The biggest missing proven feature is a **map view of houses**.

Sources: [SPOTIO D2D](https://spotio.com/solutions/door-to-door-sales/),
[SalesRabbit guide](https://www.knockbase.com/blog/the-ultimate-guide-to-salesrabbit-for-door-to-door-sales-teams),
[SPOTIO vs SalesRabbit](https://www.ecanvasser.com/blog/salesrabbit-vs-spotio)

---

## 2. What works (research-backed)

**Mobile-first & one-handed use.** Mobile is the primary interface for field
reps. Put all critical navigation and actions at the **bottom of the screen**,
within thumb reach, so the app works one-handed while walking.
→ *StopBack already does this with the 5-tab bottom nav.*

**Offline capability.** A field CRM must work offline — access and edit data with
no signal, then sync when back online. Critical in suburban/rural areas.
→ *We store locally; next step is a true installable offline PWA.*

**Speed beats features.** SalesRabbit wins on "rep usability and speed in the
field" — easy to learn, fast to log. Reps prefer the faster tool.
→ *Keep StopBack fast; never add friction to the logging flow.*

**Predictive / next-best-action UX.** Modern CRMs surface "the next best action
most likely to move a deal forward" before the rep asks.
→ *This is exactly what our AI Coach + Hit List + Callbacks do.*

**Gamification — done right.** Progress bars and streaks can raise retention by
up to ~40% vs non-gamified UIs. But the research is specific about *how*:
- Give reps **more than one way to win**: tiered goals, **streaks** (consecutive
  active days), team targets, and **personal bests** — not just one leaderboard.
- **Activity-based points**, not only outcomes (you control activity, not luck).
- **Real-time feedback**: "the faster reps know how they're doing, the faster
  they improve."
→ *We have streaks, records, and highlights. A leaderboard should be designed
  carefully (see pitfalls).*

Sources: [eSEOspace CRM UX](https://eseospace.com/blog/the-best-ui-patterns-for-crm-applications/),
[SimplyDepo field CRM](https://simplydepo.com/industry/best-crm-for-field-sales/),
[Plecto gamification](https://www.plecto.com/blog/gamification/7-sales-gamification-ideas-and-why-gamification-works/),
[Spokk gamification](https://www.spokk.io/blog/sales-gamification-software)

---

## 3. What does NOT work (pitfalls to avoid)

**Slow/manual data entry is the #1 killer.** 68% of sellers say CRM data entry is
their most time-consuming task; many spend 5–11+ hours/week on it. It's the top
reason reps abandon a CRM.
→ *Guard the logging flow ferociously. Fewer taps, smart defaults, voice/quick
  entry. Never make logging a stop back feel like paperwork.*

**Poor mobile UX pushes reps away.** Reps plan to "update it later," then forget.
If mobile feels slow or clunky, the data never gets entered.
→ *Optimistic, instant UI (no spinners); everything saves in the background.*

**"Built for managers, not reps."** Reps resist when they see no connection
between filling it out and closing deals. CRM adoption failure rates are 50–63%.
→ *Every feature should visibly help **the rep** sell more today — that's the
  whole point of the Feed/Coach. Keep that rep-first framing.*

**Leaderboards can demotivate.** A rep's prior rank affects performance; low
ranks feel disheartening. A single global leaderboard can hurt morale.
→ *If we add a leaderboard: use fair groupings, tiers, personal-best framing, and
  multiple ways to win — not one ranked list.*

Sources: [Coffee.ai – why reps ignore CRM](https://www.coffee.ai/articles/why-sales-reps-ignore-crm/),
[Nutshell – why reps quit CRMs](https://www.nutshell.com/blog/reasons-why-sales-reps-quit-their-crms),
[LeadBeam – field adoption](https://www.leadbeam.ai/blog/crm-adoption-field-sales)

---

## 4. Mobile form design rules (for the Add Stop Back / Edit forms)

From form-UX research (Baymard, Typeform, Smashing Magazine):

- **Minimize fields.** The average form has ~2x more fields than needed. Only ask
  what you'll use.
- **Single column**, top-to-bottom. (We do this.)
- **Big tap targets + padding** so thumbs don't mis-tap. (We do this.)
- **Don't slice fields.** One phone field, not 3 boxes. (We do this.)
- **Right keyboard per field.** `type="tel"` → numeric keypad, `type="email"` →
  @ keyboard. (We use `tel` and `date`.)
- **Prefer taps over typing.** Dropdowns/buttons (like our Demeanor select) beat
  free text where possible.
- **Smart defaults & autofill** to remove fields entirely.

Sources: [Smashing – mobile forms](https://www.smashingmagazine.com/2018/08/best-practices-for-mobile-form-design/),
[Typeform](https://www.typeform.com/blog/mobile-form-design-best-practices),
[Jotform](https://www.jotform.com/blog/mobile-form-design-best-practices/)

---

## 5. How StopBack already lines up

| Proven best practice | StopBack status |
|---|---|
| Bottom, thumb-reach navigation | ✅ 5-tab bottom nav |
| Fast, minimal logging form | ✅ short form, tel/date inputs, demeanor dropdown |
| Works offline | ⚠️ local storage yes; installable offline PWA = TODO |
| Follow-up / callbacks | ✅ callback dates + Feed "Callbacks Due" |
| Next-best-action | ✅ AI Coach + Hit List |
| Gamification (streaks/records/personal bests) | ✅ streaks, records, highlights |
| Map of houses + door history | ❌ not yet (biggest proven gap) |
| Lead prioritization scoring | ⚠️ heuristic coach; could add a score |
| Real friend/social + leaderboard | ⚠️ scaffolded (sample data); needs cloud |

---

## 6. Guiding principle

**Rep-first, speed-first.** Every screen should answer "how does this help me
sell more *today*?" and never slow down logging. That single rule is what
separates the apps reps love from the 50–63% that fail on adoption.
