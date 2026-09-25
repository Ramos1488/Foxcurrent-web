-- Run this once in Supabase → SQL Editor

create table if not exists foxurrent_store (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Public read + write (matches client-side admin UI).
-- For stronger security later, lock writes and use a server API.
alter table foxurrent_store enable row level security;

drop policy if exists "public read" on foxurrent_store;
drop policy if exists "public write" on foxurrent_store;
drop policy if exists "public update" on foxurrent_store;
drop policy if exists "public delete" on foxurrent_store;

create policy "public read" on foxurrent_store for select using (true);
create policy "public write" on foxurrent_store for insert with check (true);
create policy "public update" on foxurrent_store for update using (true);
create policy "public delete" on foxurrent_store for delete using (true);

insert into foxurrent_store (key, value) values
  ('projects', '[]'::jsonb),
  ('blog', '[]'::jsonb),
  ('news', '[]'::jsonb),
  ('team', '[]'::jsonb)
on conflict (key) do nothing;
