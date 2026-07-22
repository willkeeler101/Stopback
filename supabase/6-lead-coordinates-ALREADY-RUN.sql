-- Migration 5 — lead coordinates (for the Map view).
-- Adds optional GPS coordinates to each lead so they can be pinned on a map.
-- Additive and non-destructive: existing leads keep working with lat/lng NULL
-- (they simply won't show a pin until they get coordinates).
--
-- ⚠ SHARED DATABASE: do not run this alone. Per CONTRIBUTING.md, review it in
-- the PR first, then run it together in the Supabase SQL Editor. Once run,
-- rename this file to  5-lead-coordinates-ALREADY-RUN.sql.

alter table public.leads add column if not exists lat double precision;
alter table public.leads add column if not exists lng double precision;
