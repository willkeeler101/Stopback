-- ============================================================================
-- StopBack — migration 7: weekly sales goal
-- Run ONCE in Supabase → SQL Editor, AFTER files 1–6. Safe to re-run.
--
-- Adds profiles.weekly_sales_goal (integer, nullable). NULL means the rep
-- hasn't set one — the client falls back to daily_sales_goal * 6 workdays,
-- so nothing breaks before or after this runs. Powers the Feed's weekly
-- sales progress ring (Mon–Sun week).
-- ============================================================================

alter table public.profiles
  add column if not exists weekly_sales_goal integer;
