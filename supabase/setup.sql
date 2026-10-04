-- 在專案 bfecoizruicaaqxhmyqn 的 SQL Editor 執行。
-- 新增獨立快照表，不刪除／修改原本 cities 資料。
begin;
create table if not exists public.battle_monitor_state (
  id smallint primary key check (id = 1),
  cities jsonb not null default '[]'::jsonb check (jsonb_typeof(cities) = 'array'),
  status jsonb not null default '{}'::jsonb check (jsonb_typeof(status) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.battle_monitor_state enable row level security;
revoke all on public.battle_monitor_state from public, anon, authenticated;
grant select on public.battle_monitor_state to anon, authenticated;
grant select, insert, update on public.battle_monitor_state to service_role;
drop policy if exists "public_read_battle_monitor" on public.battle_monitor_state;
create policy "public_read_battle_monitor" on public.battle_monitor_state
  for select to anon, authenticated using (true);
create or replace function public.touch_battle_monitor_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
drop trigger if exists touch_battle_monitor_state on public.battle_monitor_state;
create trigger touch_battle_monitor_state before insert or update on public.battle_monitor_state
for each row execute function public.touch_battle_monitor_state();
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='battle_monitor_state') then
    alter publication supabase_realtime add table public.battle_monitor_state;
  end if;
end;
$$;
commit;
