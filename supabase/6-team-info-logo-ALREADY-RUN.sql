-- ============================================================================
-- StopBack — migration 6: Team info (description + logo) + members directory
-- Run ONCE in Supabase → SQL Editor, AFTER files 1–5. Safe to re-run.
--
-- Adds:
--   * teams.description, teams.logo_url  (both nullable — existing teams keep
--     working and render with the default 🏢 / initials fallback).
--   * update_team()  — owner-only edit of name + description (validated).
--   * set_team_logo() — owner-only logo URL setter (used after Storage upload).
--   * get_team_members() — name + EMAIL + role for the Team Info view, visible
--     ONLY to authenticated members of that same team (email privacy).
--   * get_my_teams() re-created to also return description + logo_url.
--   * A public 'team-logos' Storage bucket with owner-only write policies
--     (path convention: '<team_id>/logo', enforced server-side).
-- ============================================================================

-- 1. New columns (safe defaults: null) --------------------------------------
alter table public.teams
  add column if not exists description text,
  add column if not exists logo_url    text;

-- 2. Owner-only edit of team name + description ------------------------------
create or replace function public.update_team(p_team uuid, p_name text, p_description text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team, auth.uid()) then
    raise exception 'Only the owner can edit the team';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Team name is required';
  end if;
  if length(trim(p_name)) > 60 then
    raise exception 'Team name is too long (max 60)';
  end if;
  if p_description is not null and length(p_description) > 500 then
    raise exception 'Description is too long (max 500)';
  end if;
  update public.teams
     set name        = trim(p_name),
         description = nullif(trim(coalesce(p_description, '')), '')
   where id = p_team;
end;
$$;

-- 3. Owner-only logo URL setter (null/'' clears it) -------------------------
create or replace function public.set_team_logo(p_team uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_owner(p_team, auth.uid()) then
    raise exception 'Only the owner can change the logo';
  end if;
  update public.teams
     set logo_url = nullif(trim(coalesce(p_url, '')), '')
   where id = p_team;
end;
$$;

-- 4. Team members directory (name + email + role) ---------------------------
-- Emails are returned ONLY to members of the same team (the guard makes the
-- result empty for everyone else — so no one can enumerate another team's
-- directory by guessing a team id). Owner sorts first.
create or replace function public.get_team_members(p_team uuid)
returns table (
  user_id      uuid,
  display_name text,
  username     text,
  email        text,
  role         text,
  is_self      boolean
)
language sql stable security definer set search_path = public as $$
  with guard as (select 1 where public.is_team_member(p_team, auth.uid()))
  select p.id, p.display_name, p.username, p.email, m.role, (p.id = auth.uid())
  from public.team_members m
  join public.profiles p on p.id = m.user_id
  where m.team_id = p_team
    and exists (select 1 from guard)
  order by (m.role = 'owner') desc, lower(coalesce(p.display_name, p.username));
$$;

-- 5. get_my_teams() now also returns description + logo_url ------------------
drop function if exists public.get_my_teams();
create function public.get_my_teams()
returns table (
  id uuid, name text, description text, logo_url text,
  join_code text, owner_id uuid, is_owner boolean, member_count int
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.description, t.logo_url, t.join_code, t.owner_id,
         (t.owner_id = auth.uid()),
         (select count(*)::int from public.team_members m where m.team_id = t.id)
  from public.teams t
  where public.is_team_member(t.id, auth.uid());
$$;

-- 6. Grants ------------------------------------------------------------------
grant execute on function public.update_team(uuid, text, text)  to authenticated;
grant execute on function public.set_team_logo(uuid, text)      to authenticated;
grant execute on function public.get_team_members(uuid)         to authenticated;
grant execute on function public.get_my_teams()                 to authenticated;

-- 7. Storage bucket for team logos ------------------------------------------
-- Public READ (logos show for all teammates without signed URLs); WRITE is
-- owner-only, enforced on the server by the policies below. Files live at
-- '<team_id>/logo', so we can check ownership from the object's folder name.
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

drop policy if exists "team logos public read"   on storage.objects;
drop policy if exists "team logos owner insert"   on storage.objects;
drop policy if exists "team logos owner update"   on storage.objects;
drop policy if exists "team logos owner delete"   on storage.objects;

create policy "team logos public read" on storage.objects
  for select using ( bucket_id = 'team-logos' );

create policy "team logos owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'team-logos'
    and public.is_team_owner( ((storage.foldername(name))[1])::uuid, auth.uid() )
  );

create policy "team logos owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'team-logos'
    and public.is_team_owner( ((storage.foldername(name))[1])::uuid, auth.uid() )
  );

create policy "team logos owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'team-logos'
    and public.is_team_owner( ((storage.foldername(name))[1])::uuid, auth.uid() )
  );

-- Done. After running this, rename the file to 6-team-info-logo-ALREADY-RUN.sql.
-- ============================================================================
