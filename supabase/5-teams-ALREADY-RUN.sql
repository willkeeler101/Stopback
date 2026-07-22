-- ============================================================================
-- StopBack — migration 5: Teams (company crews + rankings + insights)
-- Run ONCE in Supabase → SQL Editor, AFTER files 1–4. Safe to re-run.
--
-- What this adds:
--   * teams / team_members — a manager ("owner") creates a team and reps join
--     with a short CODE. Membership implies stat-sharing WITHIN that team
--     (that's the whole point — it's a work crew run by the owner). No
--     share_stats toggle here: joining a team = your numbers count on it.
--   * SECURITY DEFINER helpers + RPCs so the client never reads another user's
--     rows directly across the team (mirrors the friends model in files 1–2).
--   * get_team_overview() — ranking rows + the inputs for three insights:
--     close rate vs team, pace/momentum, and best time of day.
--
-- Privacy: a team only ever sees AGGREGATE stats of its members (counts +
-- sale timestamps for the time-of-day chart) — never raw leads, prospect
-- names, phone numbers, or emails. Nothing is exposed outside the team.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  join_code  text unique not null,
  created_at timestamptz not null default now()
);
create index if not exists teams_owner_idx on public.teams(owner_id);

create table if not exists public.team_members (
  id        uuid primary key default gen_random_uuid(),
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members(user_id);
create index if not exists team_members_team_idx on public.team_members(team_id);

-- 2. Helpers -----------------------------------------------------------------
-- SECURITY DEFINER so RLS policies can call them without recursing on the
-- same table (same trick as are_friends in file 1).
create or replace function public.is_team_member(t uuid, u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members m where m.team_id = t and m.user_id = u);
$$;

create or replace function public.is_team_owner(t uuid, u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams tt where tt.id = t and tt.owner_id = u);
$$;

-- 3. Row-Level Security ------------------------------------------------------
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

-- teams: owner + members can read; only the owner writes.
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select using ( owner_id = auth.uid() or public.is_team_member(id, auth.uid()) );

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams
  for insert with check ( owner_id = auth.uid() );

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams
  for update using ( owner_id = auth.uid() ) with check ( owner_id = auth.uid() );

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams
  for delete using ( owner_id = auth.uid() );

-- team_members: you see the rosters of teams you belong to; you can add
-- yourself (join) and remove yourself (leave); the owner can remove anyone.
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select using ( public.is_team_member(team_id, auth.uid()) );

drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members
  for insert with check ( user_id = auth.uid() );

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members
  for delete using ( user_id = auth.uid() or public.is_team_owner(team_id, auth.uid()) );

-- 4. RPCs --------------------------------------------------------------------

-- Create a team; caller becomes owner + first member. Returns the new row.
create or replace function public.create_team(p_name text)
returns table (id uuid, name text, join_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_code text;
  v_alph text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no ambiguous 0/O/1/I/L
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Team name required';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alph, floor(random() * length(v_alph))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from public.teams t where t.join_code = v_code);
  end loop;

  insert into public.teams (name, owner_id, join_code)
  values (trim(p_name), auth.uid(), v_code)
  returning teams.id into v_id;

  insert into public.team_members (team_id, user_id, role)
  values (v_id, auth.uid(), 'owner');

  return query select v_id, trim(p_name), v_code;
end;
$$;

-- Join by code (case-insensitive). Idempotent if already a member.
create or replace function public.join_team_by_code(p_code text)
returns table (id uuid, name text, role text)
language plpgsql security definer set search_path = public as $$
declare v_team public.teams;
begin
  select * into v_team from public.teams t
    where upper(t.join_code) = upper(trim(p_code));
  if v_team.id is null then
    raise exception 'No team found for that code';
  end if;
  insert into public.team_members (team_id, user_id, role)
  values (v_team.id, auth.uid(), 'member')
  on conflict (team_id, user_id) do nothing;
  return query
    select v_team.id, v_team.name,
      (select m.role from public.team_members m
        where m.team_id = v_team.id and m.user_id = auth.uid());
end;
$$;

-- Leave a team (members only; the owner deletes the team instead).
create or replace function public.leave_team(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_team_owner(p_team, auth.uid()) then
    raise exception 'The owner cannot leave; delete the team instead';
  end if;
  delete from public.team_members where team_id = p_team and user_id = auth.uid();
end;
$$;

-- Delete a team (owner only; cascades to members).
create or replace function public.delete_team(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team, auth.uid()) then
    raise exception 'Only the owner can delete the team';
  end if;
  delete from public.teams where id = p_team;
end;
$$;

-- Remove a member (owner only).
create or replace function public.remove_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team, auth.uid()) then
    raise exception 'Only the owner can remove members';
  end if;
  if p_user = auth.uid() then
    raise exception 'Delete the team to remove yourself as owner';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user;
end;
$$;

-- Teams the caller belongs to (for the management UI).
create or replace function public.get_my_teams()
returns table (
  id uuid, name text, join_code text, owner_id uuid,
  is_owner boolean, member_count int
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.join_code, t.owner_id,
         (t.owner_id = auth.uid()),
         (select count(*)::int from public.team_members m where m.team_id = t.id)
  from public.teams t
  where public.is_team_member(t.id, auth.uid());
$$;

-- 5. Team overview — ranking rows + insight inputs ---------------------------
-- Returns a row per member of p_team, but ONLY if the caller is a member
-- (the `guard` makes `people` empty otherwise). Aggregates only — never leads.
--   * today/week/all      -> the ranking board
--   * prev_week           -> pace & momentum (this week vs last)
--   * month + missed      -> close rate vs the team
--   * sale_times_month    -> best time of day (client buckets by local hour)
create or replace function public.get_team_overview(p_team uuid)
returns table (
  user_id             uuid,
  username            text,
  display_name        text,
  is_self             boolean,
  role                text,
  current_streak      int,
  stopbacks_today     int,
  sales_today         int,
  stopbacks_week      int,
  sales_week          int,
  stopbacks_all       int,
  sales_all           int,
  stopbacks_prev_week int,
  sales_prev_week     int,
  stopbacks_month     int,
  sales_month         int,
  missed_month        int,
  contacts_month      int,
  sale_times_month    timestamptz[]
)
language sql stable security definer set search_path = public as $$
  with guard as (
    select 1 where public.is_team_member(p_team, auth.uid())
  ),
  people as (
    select p.*, m.role
    from public.team_members m
    join public.profiles p on p.id = m.user_id
    where m.team_id = p_team
      and exists (select 1 from guard)
  )
  select
    pe.id, pe.username, pe.display_name, (pe.id = auth.uid()), pe.role,
    pe.current_streak,
    coalesce(c.sb_today, 0)::int, coalesce(c.sl_today, 0)::int,
    coalesce(c.sb_week, 0)::int,  coalesce(c.sl_week, 0)::int,
    (pe.baseline_stopbacks + coalesce(c.sb_all, 0))::int,
    (pe.baseline_sales     + coalesce(c.sl_all, 0))::int,
    coalesce(c.sb_prev, 0)::int,  coalesce(c.sl_prev, 0)::int,
    coalesce(c.sb_month, 0)::int, coalesce(c.sl_month, 0)::int,
    coalesce(c.ms_month, 0)::int, coalesce(ev.taps_month, 0)::int,
    coalesce(c.sale_times_month, '{}'::timestamptz[])
  from people pe
  left join lateral (
    select
      count(*) filter (where l.created_at >= date_trunc('day', now()))  as sb_today,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= date_trunc('day', now())) as sl_today,
      count(*) filter (where l.created_at >= now() - interval '7 days')  as sb_week,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= now() - interval '7 days') as sl_week,
      count(*)                                                           as sb_all,
      count(*) filter (where l.status = 'sale')                          as sl_all,
      count(*) filter (where l.created_at >= now() - interval '14 days'
                         and l.created_at <  now() - interval '7 days')  as sb_prev,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= now() - interval '14 days'
        and coalesce(l.sold_at, l.created_at) <  now() - interval '7 days') as sl_prev,
      count(*) filter (where l.created_at >= now() - interval '30 days') as sb_month,
      count(*) filter (where l.status = 'sale'
        and coalesce(l.sold_at, l.created_at) >= now() - interval '30 days') as sl_month,
      count(*) filter (where l.status = 'missed'
        and l.created_at >= now() - interval '30 days')                  as ms_month,
      array_agg(l.sold_at order by l.sold_at)
        filter (where l.status = 'sale' and l.sold_at is not null
                  and l.sold_at >= now() - interval '30 days')           as sale_times_month
    from public.leads l
    where l.user_id = pe.id
  ) c on true
  left join lateral (
    select count(*) filter (where e.created_at >= now() - interval '30 days') as taps_month
    from public.log_events e
    where e.user_id = pe.id and e.type = 'contact'
  ) ev on true;
$$;

-- 6. Grants ------------------------------------------------------------------
grant execute on function public.is_team_member(uuid, uuid)  to authenticated;
grant execute on function public.is_team_owner(uuid, uuid)   to authenticated;
grant execute on function public.create_team(text)           to authenticated;
grant execute on function public.join_team_by_code(text)     to authenticated;
grant execute on function public.leave_team(uuid)            to authenticated;
grant execute on function public.delete_team(uuid)           to authenticated;
grant execute on function public.remove_member(uuid, uuid)   to authenticated;
grant execute on function public.get_my_teams()              to authenticated;
grant execute on function public.get_team_overview(uuid)     to authenticated;

-- Done. After running this, rename the file to 5-teams-ALREADY-RUN.sql.
-- ============================================================================
