-- ============================================================================
-- StopBack — Supabase schema
-- Run this in the Supabase dashboard → SQL Editor (paste all, click Run).
-- Requires Postgres 15+ (Supabase default) for security_invoker views.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE.
--
-- Design notes:
--   * leads / log_events / products are PRIVATE to their owner (customer PII).
--   * Friends can read a limited, shareable stats surface only — never leads.
--   * XP / levels / streaks stay derived; we don't store a stats table.
-- ============================================================================

-- 1. Extensions --------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- 2. Tables ------------------------------------------------------------------

-- profiles: one row per auth user (created automatically on signup, see §4)
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           text unique not null,
  display_name       text,
  daily_goal         int  not null default 5,
  baseline_contacts  int  not null default 0,   -- "import past stats" (undated)
  baseline_stopbacks int  not null default 0,
  baseline_missed    int  not null default 0,
  baseline_sales     int  not null default 0,
  active_days        date[] not null default '{}',   -- historical streak dates
  gamify             jsonb not null default '{}'::jsonb, -- badges, markers
  imported_at        timestamptz,                 -- one-time import guard
  created_at         timestamptz not null default now()
);

-- leads: the pipeline (private)
create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  phone      text,
  address    text,
  interest   text check (interest in ('Interested','Maybe','Unlikely')),
  demeanor   text,                                -- legacy field, preserved
  notes      text,
  callback   date,
  status     text not null default 'stopback'
             check (status in ('stopback','missed','sale')),
  created_at timestamptz not null default now(),  -- keep original on import
  updated_at timestamptz not null default now()
);
create index if not exists leads_user_created_idx  on public.leads(user_id, created_at);
create index if not exists leads_user_status_idx   on public.leads(user_id, status);
create index if not exists leads_user_callback_idx on public.leads(user_id, callback);

-- log_events: activity ledger — mainly "contact" (door, no number) taps
create table if not exists public.log_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null default 'contact'
             check (type in ('contact','stopback','missed','sale')),
  lead_id    uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists log_events_user_created_idx on public.log_events(user_id, created_at);

-- products: the rep's catalog (private)
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  price      text,
  features   text,
  created_at timestamptz not null default now()
);
create index if not exists products_user_idx on public.products(user_id);

-- friendships: the social graph (self-referential many-to-many)
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','accepted','blocked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create index if not exists friendships_addressee_idx on public.friendships(addressee_id);

-- 3. Helper: are two users accepted friends? --------------------------------
-- SECURITY DEFINER so it can be used inside RLS without recursive checks.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ( (f.requester_id = a and f.addressee_id = b)
         or (f.requester_id = b and f.addressee_id = a) )
  );
$$;

-- 4. Auto-create a profile row when a user signs up -------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'rep_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Row-Level Security ------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.leads       enable row level security;
alter table public.log_events  enable row level security;
alter table public.products    enable row level security;
alter table public.friendships enable row level security;

-- profiles: read self OR an accepted friend; write only your own row
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using ( id = auth.uid() or public.are_friends(auth.uid(), id) );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check ( id = auth.uid() );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using ( id = auth.uid() ) with check ( id = auth.uid() );

-- leads / log_events / products: owner-only for every action
drop policy if exists leads_all on public.leads;
create policy leads_all on public.leads
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists log_events_all on public.log_events;
create policy log_events_all on public.log_events
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

drop policy if exists products_all on public.products;
create policy products_all on public.products
  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

-- friendships: visible to either party; create only as yourself
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select using ( requester_id = auth.uid() or addressee_id = auth.uid() );

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert with check ( requester_id = auth.uid() );

drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update using ( requester_id = auth.uid() or addressee_id = auth.uid() );

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete using ( requester_id = auth.uid() or addressee_id = auth.uid() );

-- 6. Own daily trends (powers the Stats 7-day bars) -------------------------
-- security_invoker => underlying-table RLS applies, so this only ever
-- returns the querying user's own days.
create or replace view public.v_daily_stats
with (security_invoker = true) as
select
  user_id,
  day,
  sum(is_contact)::int  as contacts,
  sum(is_stopback)::int as stopbacks,
  sum(is_missed)::int   as missed,
  sum(is_sale)::int     as sales
from (
  select user_id,
         date_trunc('day', created_at)::date as day,
         1 as is_contact, 0 as is_stopback, 0 as is_missed, 0 as is_sale
  from public.log_events
  where type = 'contact'
  union all
  select user_id,
         date_trunc('day', created_at)::date,
         0,
         1,
         case when status = 'missed' then 1 else 0 end,
         case when status = 'sale'   then 1 else 0 end
  from public.leads
) t
group by user_id, day;

-- 7. Shareable top-line totals for self OR an accepted friend ---------------
-- SECURITY DEFINER: enforces the friendship check internally, then returns
-- ONLY aggregate counts (never raw leads).
create or replace function public.get_user_stats(target uuid)
returns table (contacts int, stopbacks int, missed int, sales int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare p public.profiles;
begin
  if target <> auth.uid() and not public.are_friends(auth.uid(), target) then
    raise exception 'not authorized';
  end if;

  select * into p from public.profiles where id = target;

  return query
  select
    ( p.baseline_contacts
      + (select count(*) from public.log_events e where e.user_id = target and e.type = 'contact')
      + (select count(*) from public.leads l where l.user_id = target) )::int,
    ( p.baseline_stopbacks
      + (select count(*) from public.leads l where l.user_id = target) )::int,
    ( p.baseline_missed
      + (select count(*) from public.leads l where l.user_id = target and l.status = 'missed') )::int,
    ( p.baseline_sales
      + (select count(*) from public.leads l where l.user_id = target and l.status = 'sale') )::int;
end;
$$;

-- 8. Friend search (safe columns only, so discovery doesn't leak goals) -----
create or replace function public.search_profiles(q text)
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, username, display_name
  from public.profiles
  where username ilike '%' || q || '%'
  limit 20;
$$;

-- 9. Grants ------------------------------------------------------------------
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.get_user_stats(uuid)    to authenticated;
grant execute on function public.search_profiles(text)   to authenticated;

-- Done. Next: create your account in the app, then run the one-time import.
