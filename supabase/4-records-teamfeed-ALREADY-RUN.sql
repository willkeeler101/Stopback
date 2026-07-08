-- ============================================================================
-- StopBack — migration 4: richer team feed + records data
-- Run ONCE in Supabase → SQL Editor, AFTER files 1–3 in this folder.
-- Safe to re-run. Nothing here deletes or overwrites data.
--
-- Extends get_friends_overview() with the fields the live team feed,
-- weekly recognition, and friend-comparison insights need:
--   goals, contact tap counts, yesterday's totals, missed-this-week,
--   and the person's gamify jsonb (badges + personal records — no PII).
-- Still gated by friendship + share_stats exactly as before.
-- ============================================================================

drop function if exists public.get_friends_overview();

create function public.get_friends_overview()
returns table (
  user_id             uuid,
  username            text,
  display_name        text,
  is_self             boolean,
  current_streak      int,
  daily_goal          int,
  daily_sales_goal    int,
  gamify              jsonb,
  contact_taps_today  int,   -- "+1" doors logged today (no number gotten)
  contact_taps_week   int,
  stopbacks_all       int,
  sales_all           int,
  stopbacks_today     int,
  sales_today         int,
  stopbacks_week      int,
  sales_week          int,
  stopbacks_yesterday int,
  sales_yesterday     int,
  missed_week         int,
  sale_times_today    timestamptz[],
  sale_days           date[]
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
    pe.daily_goal, pe.daily_sales_goal,
    pe.gamify,
    coalesce(ev.taps_today, 0)::int, coalesce(ev.taps_week, 0)::int,
    (pe.baseline_stopbacks + coalesce(c.sb_all, 0))::int,
    (pe.baseline_sales     + coalesce(c.sl_all, 0))::int,
    coalesce(c.sb_today, 0)::int, coalesce(c.sl_today, 0)::int,
    coalesce(c.sb_week, 0)::int,  coalesce(c.sl_week, 0)::int,
    coalesce(c.sb_yest, 0)::int,  coalesce(c.sl_yest, 0)::int,
    coalesce(c.ms_week, 0)::int,
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
      count(*) filter (where l.created_at >= date_trunc('day', now()) - interval '1 day'
                         and l.created_at <  date_trunc('day', now())) as sb_yest,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= date_trunc('day', now()) - interval '1 day'
        and coalesce(l.sold_at, l.created_at) <  date_trunc('day', now())) as sl_yest,
      count(*) filter (where l.status = 'missed'
        and l.created_at >= now() - interval '7 days')                  as ms_week,
      array_agg(l.sold_at order by l.sold_at)
        filter (where l.status = 'sale' and l.sold_at is not null
                  and l.sold_at >= date_trunc('day', now()))            as sale_times_today,
      array_agg(distinct coalesce(l.sold_at, l.created_at)::date)
        filter (where l.status = 'sale'
                  and coalesce(l.sold_at, l.created_at) >= now() - interval '30 days')
                                                                        as sale_days
    from public.leads l
    where l.user_id = pe.id
  ) c on true
  left join lateral (
    select
      count(*) filter (where e.created_at >= date_trunc('day', now()))  as taps_today,
      count(*) filter (where e.created_at >= now() - interval '7 days') as taps_week
    from public.log_events e
    where e.user_id = pe.id and e.type = 'contact'
  ) ev on true;
$$;

grant execute on function public.get_friends_overview() to authenticated;

-- Done.
