-- V1 is single-user with no auth. Allow full anon access on all tables.
-- Replace with authenticated-user policies if auth is added later.

alter table programs          enable row level security;
alter table workout_templates  enable row level security;
alter table exercise_templates enable row level security;
alter table sessions           enable row level security;
alter table set_logs           enable row level security;
alter table exercise_notes     enable row level security;

create policy "anon full access" on programs          for all to anon using (true) with check (true);
create policy "anon full access" on workout_templates  for all to anon using (true) with check (true);
create policy "anon full access" on exercise_templates for all to anon using (true) with check (true);
create policy "anon full access" on sessions           for all to anon using (true) with check (true);
create policy "anon full access" on set_logs           for all to anon using (true) with check (true);
create policy "anon full access" on exercise_notes     for all to anon using (true) with check (true);
