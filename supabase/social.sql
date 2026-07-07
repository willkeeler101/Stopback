-- ============================================================================
-- StopBack — Social features migration (Phase 3)
-- Run this in Supabase → SQL Editor AFTER schema.sql. Safe to re-run.
--
-- Privacy model:
--   * Nothing is shared until a friendship is ACCEPTED.
--   * Friends never read your tables directly — RLS keeps rows owner-only.
--     All friend reads go through SECURITY DEFINER functions below, which
--     enforce the friendship + your per-toggle sharing settings.
--   * share_stats  -> friends see your summary counts + streak (feed + board)
--   * share_leads  -> friends can view your stop-back list (names/notes)
--   * share_phone  -> include phone numbers in that list (off by default)
-- ============================================================================

-- 1. Privacy + social columns on profiles -----------------------------------
alter table public.profiles
  add column if not exists email          text,
  add column if not exists share_stats    boolean not null default true,
  add column if not exists share_leads    boolean not null default false,
  add column if not exists share_phone    boolean not null default false,
  add column if not exists current_streak int     not null default 0;

-- Backfill email for existing accounts (from the auth table).
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- 2. Store email on new signups too -----------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'rep_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3. Lock profiles down to owner-only direct reads --------------------------
-- (Friends get access ONLY through the functions below, so your toggles and
--  column choices are always respected — email/baselines never leak.)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using ( id = auth.uid() );

-- 4. Only the RECIPIENT can accept/change a friend request ------------------
-- Prevents a sender from self-accepting and peeking at your data.
drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update using ( addressee_id = auth.uid() )
  with check ( addressee_id = auth.uid() );

-- 5. Find people to add (by username, or exact email) -----------------------
create or replace function public.search_profiles(q text)
returns table (id uuid, username text, display_name text)
language sql stable security definer set search_path = public as $$
  select id, username, display_name
  from public.profiles
  where id <> auth.uid()
    and ( username ilike '%' || q || '%' or lower(email) = lower(q) )
  limit 20;
$$;

-- 6. My friendships (requests + friends) with the other person's name -------
create or replace function public.get_friendships()
returns table (
  friendship_id uuid,
  other_id      uuid,
  username      text,
  display_name  text,
  status        text,
  direction     text   -- 'incoming' | 'outgoing'
)
language sql stable security definer set search_path = public as $$
  select
    f.id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
    p.username,
    p.display_name,
    f.status,
    case when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where f.requester_id = auth.uid() or f.addressee_id = auth.uid();
$$;

-- 7. Stats overview for me + accepted friends (feed + leaderboard) ----------
-- Only includes a friend if they've accepted AND left share_stats on.
create or replace function public.get_friends_overview()
returns table (
  user_id        uuid,
  username       text,
  display_name   text,
  is_self        boolean,
  current_streak int,
  stopbacks_all  int,
  sales_all      int,
  stopbacks_today int,
  sales_today    int,
  stopbacks_week int,
  sales_week     int
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
    coalesce(c.sb_week, 0)::int,  coalesce(c.sl_week, 0)::int
  from people pe
  left join lateral (
    select
      count(*)                                                              as sb_all,
      count(*) filter (where l.status = 'sale')                             as sl_all,
      count(*) filter (where l.created_at >= date_trunc('day', now()))      as sb_today,
      count(*) filter (where l.status = 'sale'
                         and l.created_at >= date_trunc('day', now()))      as sl_today,
      count(*) filter (where l.created_at >= now() - interval '7 days')     as sb_week,
      count(*) filter (where l.status = 'sale'
                         and l.created_at >= now() - interval '7 days')     as sl_week
    from public.leads l
    where l.user_id = pe.id
  ) c on true;
$$;

-- 8. A friend's stop-back list (only if they share_leads; phone gated) ------
create or replace function public.get_friend_leads(target uuid)
returns table (
  id uuid, name text, phone text, address text,
  interest text, notes text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = target;
  if target <> auth.uid() then
    if not public.are_friends(auth.uid(), target) or not p.share_leads then
      raise exception 'not authorized';
    end if;
  end if;
  return query
  select
    l.id, l.name,
    case when target = auth.uid() or p.share_phone then l.phone else null end,
    l.address, l.interest, l.notes, l.status, l.created_at
  from public.leads l
  where l.user_id = target
  order by l.created_at desc;
end;
$$;

-- 9. Grants ------------------------------------------------------------------
grant execute on function public.search_profiles(text)      to authenticated;
grant execute on function public.get_friendships()          to authenticated;
grant execute on function public.get_friends_overview()     to authenticated;
grant execute on function public.get_friend_leads(uuid)     to authenticated;

-- Done. Next: privacy toggles UI + streak sync, then the friends UI, feed,
-- and leaderboard (client-side).
