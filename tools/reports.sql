-- Meldungen unterwegs (Stau, Unfall, Baustelle …) für WMap – Supabase/PostgreSQL.
-- Danach in js/config.js unter REPORTS die Projekt-URL und den anon-Schlüssel eintragen.

create table if not exists reports (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('jam', 'accident', 'roadworks', 'hazard', 'closure')),
  lon         double precision not null check (lon between -180 and 180),
  lat         double precision not null check (lat between -90 and 90),
  answer      text not null default 'new' check (answer in ('new', 'yes', 'no')),
  ref         text,                      -- z. B. Kennung einer Autobahn-Meldung
  created_at  timestamptz not null default now()
);
create index if not exists reports_where on reports (created_at, lon, lat);

alter table reports enable row level security;

-- Lesen: nur die letzten 6 Stunden
create policy "aktuelle lesen" on reports for select
  using (created_at > now() - interval '6 hours');

-- Schreiben: anonym erlaubt, aber nur mit Zeitstempel „jetzt“
create policy "anonym melden" on reports for insert
  with check (created_at > now() - interval '1 minute');

-- Aufräumen (z. B. per pg_cron täglich): alles älter als 2 Tage
-- delete from reports where created_at < now() - interval '2 days';
