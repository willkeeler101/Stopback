# StopBack Map — Territory Architecture

The map is the rep's command center: where to go, who to revisit, who to
call, which streets are strongest, where opportunity remains. Every phase
below serves one rule — **reduce wasted walking, maximize selling time** —
and one constraint — **never render a feature whose data doesn't exist yet.**

## Phase A — SHIPPED (real data only)

Runs entirely on `leads.lat/lng` (migration 5) + interest + callbacks:

| Capability | Implementation |
|---|---|
| Premium basemaps | CARTO Voyager (CSS-warmed to brand) + Esri satellite; persisted choice |
| Smart pins | tone = status+interest; ring = callback due/overdue; priority pulse |
| Clustering | leaflet.markercluster CDN, `layerGroup` fallback, off at zoom ≥17 |
| Quick actions | bottom sheet → existing `toggleStatus`/`deleteLead`/`openEdit` |
| Filters | chip row; legend dots = pin colors |
| Callback zones | densest ≤150 m group of due callbacks, tap-to-zoom insight |
| Locate me | `map.locate` + blue-dot convention |

Decisions worth remembering:
- **"Due" is defined once.** The map imports the Hit List's
  `callbackOverdue`/`localDateStr` semantics via `leadCallbackState()`.
  If priority logic ever changes, change it in one place.
- **The sheet owns no logic.** Reschedule/notes route to the edit modal;
  status changes route to `toggleStatus`. No parallel mutation paths.
- **Viewport discipline.** `fitBounds` fires only on mode/filter entry —
  a background sync must never yank the map while a rep is panning.

## Phase B — needs knock-level geo data (the real unlock)

Heatmaps, street performance, door coverage, timeline replay, route
optimization, and territory scores all require **one new fact per knock**,
not per lead. That is roadmap item #2 (one-tap door disposition) plus GPS:

```sql
-- 6-knocks-RUN-ME.sql (draft — do NOT run until door-disposition ships)
create table if not exists public.knocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  lat         double precision,
  lng         double precision,
  street      text,          -- reverse-geocoded ONCE at capture, cached
  disposition text not null check (disposition in
                ('not_home','no','callback','stopback','sale')),
  lead_id     uuid references public.leads(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- RLS: owner-only, same pattern as leads. Index (user_id, created_at).
```

What each feature then reads:
- **Heatmap** — `leaflet.heat` over knock points, weighted by disposition
  (sale=5, stopback=3, contact=1); overlay picker for sales/stop-backs/all.
- **Door coverage** — knock density per street per time window
  (today/week/all-time) → green/partial/untouched street tinting.
- **Street performance & notes** — aggregate knocks+leads by `street`;
  `street_notes(user_id, street, note)` table for HOA/dogs/gate codes.
- **Timeline** — slider filtering knocks by `created_at`; replay = ordered
  polyline of the day's knocks.
- **Today's route** — nearest-neighbor + 2-opt over due callbacks and
  hot leads (client-side; fine to ~50 stops), deep-link turn-by-turn to
  the phone's native maps app.
- **Territory score** — per street: close rate × recency decay ×
  callback density (weather/seasonality slots reserved in the formula).
- **Territories** — `territories(user_id, name, polygon jsonb)` drawn with
  leaflet-geoman; stats = point-in-polygon over knocks/leads.

Street identity: reverse-geocode **once at capture** (Nominatim, 1 req/s
policy, cached into `knocks.street`) — never bulk-geocode on render.

## Phase C — friends, offline, AI

- **Friend layer:** `get_friend_leads` RPC already gates by privacy
  toggles; add lat/lng to its return once migration 5 is live. Live rep
  positions = Supabase Realtime channel + a `share_location` toggle
  (default OFF — battery + privacy).
- **Offline:** PWA service worker caching the app shell + visited tiles;
  IndexedDB write queue that replays `db*` calls on reconnect. The
  optimistic-UI pattern already makes the app tolerate slow writes.
- **AI (interfaces only, per project rule: WHO not HOW):**
  `getTerritorySnapshot()` → `{ leads, knocks, streets, dueCallbacks,
  weekStats }` JSON — the single contract a future Edge Function consumes
  to return `{ bestStreetNow, callbackOrder, topLead }`. Keep ranking
  server-side so keys stay out of the client.

## Performance budget

- 10k+ leads: clustering caps DOM nodes; `chunkedLoading` spreads adds.
- Zone insight is O(n²) over **due callbacks only**, capped at 400.
- At Phase B scale (100k knocks): move aggregates to Postgres
  (`v_street_stats` view or PostGIS) — never ship raw knocks to the phone.
- If raster tiles ever feel dated: MapLibre GL + vector tiles is the
  upgrade path (still no build step — CDN UMD bundle).
- Tile licensing: CARTO/Esri free tiers are fine for a small team;
  revisit at real production volume.

## Deliberately rejected

- **Empty-data UI** (heatmap/coverage widgets before knocks exist) — gimmick.
- **A 6th nav tab** — the 5-tab nav with center Log is the brand.
- **Selling advice on the map** — same rule as the feed: WHO, never HOW.
