-- ============================================================================
-- StopBack — Phase 3 part 2 migration (covers tasks A–D)
-- Run ONCE in Supabase → SQL Editor, AFTER files 1 and 2 in this folder.
-- Safe to re-run. Nothing here deletes or overwrites existing data.
--
-- Adds:
--   A. leads.callback_at  — callback with date AND time (old date-only
--      values are copied in at noon UTC so they stay on the right day;
--      the legacy `callback` column is left untouched as a backup).
--   B. profiles.daily_sales_goal — the second goal ring on the Feed.
--   D. leads.sold_at — real timestamp when a lead is marked "sale"
--      (powers the 2-sales-in-an-hour achievement; older sales without
--      a timestamp simply don't count for that one).
--   D. Richer get_friends_overview() for the real team feed:
--      achievement inputs for you + accepted friends who share stats.
--
-- Note: "today"/"this week" use UTC day boundaries; fine for v1.
-- ============================================================================

-- A. Callback with time -------------------------------------------------------
alter table public.leads
  add column if not exists callback_at timestamptz;

update public.leads
  set callback_at = ((callback::timestamp + interval '12 hours') at time zone 'utc')
  where callback is not null and callback_at is null;

create index if not exists leads_user_callback_at_idx
  on public.leads(user_id, callback_at);

-- B. Daily sales goal ---------------------------------------------------------
alter table public.profiles
  add column if not exists daily_sales_goal int not null default 2;

-- D. Sale timestamps ----------------------------------------------------------
alter table public.leads
  add column if not exists sold_at timestamptz;

-- D. Richer overview (return type changes, so drop the old version first) ----
drop function if exists public.get_friends_overview();

create function public.get_friends_overview()
returns table (
  user_id          uuid,
  username         text,
  display_name     text,
  is_self          boolean,
  current_streak   int,
  stopbacks_all    int,
  sales_all        int,
  stopbacks_today  int,
  sales_today      int,
  stopbacks_week   int,
  sales_week       int,
  sale_times_today timestamptz[],  -- real sold_at stamps today (hot-streak check)
  sale_days        date[]          -- distinct sale dates, last 30 days (sales streak)
)
language sql stable security definer set search_path = public as $$
  with people as (
    select p.* from public.profiles p
    where p.id = auth.uid()
       or ( public.are_friends(auth.uid(), p.id) and p.share_stats )
  )
  select
    pe.id, pe.username, pe.display_name, (pe.id = auth.uid()),
    pe.current_streak,
    (pe.baseline_stopbacks + coalesce(c.sb_all, 0))::int,
    (pe.baseline_sales     + coalesce(c.sl_all, 0))::int,
    coalesce(c.sb_today, 0)::int, coalesce(c.sl_today, 0)::int,
    coalesce(c.sb_week, 0)::int,  coalesce(c.sl_week, 0)::int,
    coalesce(c.sale_times_today, '{}'::timestamptz[]),
    coalesce(c.sale_days, '{}'::date[])
  from people pe
  left join lateral (
    select
      count(*)                                                          as sb_all,
      count(*) filter (where l.status = 'sale')                         as sl_all,
      count(*) filter (where l.created_at >= date_trunc('day', now()))  as sb_today,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= date_trunc('day', now())) as sl_today,
      count(*) filter (where l.created_at >= now() - interval '7 days') as sb_week,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= now() - interval '7 days') as sl_week,
      array_agg(l.sold_at order by l.sold_at)
        filter (where l.status = 'sale' and l.sold_at is not null
                  and l.sold_at >= date_trunc('day', now()))            as sale_times_today,
      array_agg(distinct coalesce(l.sold_at, l.created_at)::date)
        filter (where l.status = 'sale'
                  and coalesce(l.sold_at, l.created_at) >= now() - interval '30 days')
                                                                        as sale_days
    from public.leads l
    where l.user_id = pe.id
  ) c on true;
$$;

grant execute on function public.get_friends_overview() to authenticated;

-- Done. The Feed's hit list, achievements, and (later) leaderboard read this.
