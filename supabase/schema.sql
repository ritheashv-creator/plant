-- ============================================================
-- Butterscotch Smart Plant Monitor — Supabase schema
-- Run this once in your Supabase project's SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run).
-- ============================================================

create table if not exists public.readings (
  id                          bigint generated always as identity primary key,
  created_at                  timestamptz not null default now(),

  soil_moisture               numeric,   -- percent, e.g. 42.5
  emotion                     text,      -- e.g. "Happy", "Thirsty", "Sad", "Thriving"
  light_lux                   numeric,   -- current light intensity in lux
  useful_light_hours_today    numeric,   -- hours of "useful" light so far today
  avg_light_hours_per_day     numeric,   -- rolling average useful-light hours/day
  avg_lux                     numeric,   -- rolling average lux
  device_time                 timestamptz -- optional: ESP32's own NTP-synced timestamp
);

-- Helpful for the dashboard's "order by newest" queries.
create index if not exists readings_created_at_idx
  on public.readings (created_at desc);

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
-- The website only ever uses the public "anon" key, so we lock
-- it down to READ-ONLY. Inserts are done by the ESP32 using the
-- "service_role" key, which bypasses RLS entirely — so we do NOT
-- add an insert policy here on purpose.
-- ------------------------------------------------------------

alter table public.readings enable row level security;

create policy "Public can read readings"
  on public.readings
  for select
  to anon
  using (true);

-- No insert / update / delete policy is created for "anon".
-- That means the anon key (used by the public website) can only
-- ever read rows — it can never add, change, or delete data.
