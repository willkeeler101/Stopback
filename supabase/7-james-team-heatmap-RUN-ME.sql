-- ============================================================================
-- StopBack — migration 7: Team heat map (binned door/sale density)
-- Run ONCE in Supabase → SQL Editor, AFTER files 1–6. Safe to re-run.
--
-- ⚠ NOT YET RUN. Per CONTRIBUTING.md this ships in the PR un-run; the client
--   degrades to a self-only heat map (local leads) until it's applied.
--
-- Adds get_team_heat(): aggregate lead density for one team's GPS-tagged
-- doors, for the Team Intelligence "Heat map" tab.
--
-- Privacy: this is the ONLY team-level read that touches lead coordinates,
-- and it never returns a lead. Coordinates are snapped server-side to a
-- ~275 m grid (0.0025°) and only cell COUNTS leave the database — no ids,
-- no names, no statuses per row, no exact positions. The guard mirrors
-- get_team_overview: non-members of the team get zero rows.
-- ============================================================================

create or replace function public.get_team_heat(p_team uuid)
returns table (
  lat_bin  double precision,   -- cell centre latitude
  lng_bin  double precision,   -- cell centre longitude
  contacts int,                -- GPS-tagged door conversations (all statuses)
  sales    int                 -- subset with status = 'sale'
)
language sql stable security definer set search_path = public as $$
  with guard as (
    select 1 where public.is_team_member(p_team, auth.uid())
  )
  select
    floor(l.lat / 0.0025) * 0.0025 + 0.00125,
    floor(l.lng / 0.0025) * 0.0025 + 0.00125,
    count(*)::int,
    (count(*) filter (where l.status = 'sale'))::int
  from public.leads l
  join public.team_members m
    on m.user_id = l.user_id and m.team_id = p_team
  where l.lat is not null and l.lng is not null
    and l.created_at >= now() - interval '90 days'
    and exists (select 1 from guard)
  group by 1, 2;
$$;

grant execute on function public.get_team_heat(uuid) to authenticated;

-- Done. After running this, rename the file to
-- 7-james-team-heatmap-ALREADY-RUN.sql.
-- ============================================================================
