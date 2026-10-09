-- 在現有 Supabase 專案的 SQL Editor 執行一次。
-- 僅保存已公開的控制陣營／聯盟資料；不保存帳號、權杖、原始封包或私密金鑰。
-- 每分鐘至多一個快照，同分鐘以最後收到的控制權為準；不回填過去。
begin;
create table if not exists public.battle_monitor_history (
  slot timestamptz primary key,
  captured_at timestamptz not null,
  cities jsonb not null check (jsonb_typeof(cities) = 'array')
);
create index if not exists battle_monitor_history_time on public.battle_monitor_history(captured_at);
alter table public.battle_monitor_history enable row level security;
revoke all on public.battle_monitor_history from public, anon, authenticated;
grant select on public.battle_monitor_history to anon, authenticated;
grant select, insert, update, delete on public.battle_monitor_history to service_role;
drop policy if exists public_read_battle_history on public.battle_monitor_history;
create policy public_read_battle_history on public.battle_monitor_history
for select to anon, authenticated using (true);

create or replace function public.rf_history_public_cities(input_rows jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'city_id', city->'city_id', 'name', city->'name',
    'control_nation_name', city->'control_nation_name',
    'control_union_id', city->'control_union_id',
    'control_union_name', city->'control_union_name'
  ) order by city->>'city_id'), '[]'::jsonb)
  from (select value as city from jsonb_array_elements(input_rows) limit 700) filtered;
$$;
revoke all on function public.rf_history_public_cities(jsonb) from public, anon, authenticated;

create or replace function public.capture_battle_monitor_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare captured timestamptz := clock_timestamp(); projected jsonb;
begin
  if new.status->>'connected' is distinct from 'true' or jsonb_array_length(new.cities) = 0 then return new; end if;
  projected := public.rf_history_public_cities(new.cities);
  if TG_OP = 'UPDATE' then
    if projected = public.rf_history_public_cities(old.cities) and exists (
      select 1 from public.battle_monitor_history
      where captured_at >= (date_trunc('day', captured at time zone 'Asia/Taipei') at time zone 'Asia/Taipei')
    ) then return new; end if;
  end if;
  insert into public.battle_monitor_history(slot, captured_at, cities)
  values (date_trunc('minute', captured), captured, projected)
  on conflict(slot) do update set captured_at=excluded.captured_at, cities=excluded.cities;
  -- 下一次控制權更新時清理；最多保留 2000 個快照及最近 7 天，控制免費配額。
  delete from public.battle_monitor_history where slot < captured - interval '7 days';
  delete from public.battle_monitor_history where slot < (
    select slot from public.battle_monitor_history order by slot desc offset 1999 limit 1
  );
  return new;
end;
$$;
revoke all on function public.capture_battle_monitor_history() from public, anon, authenticated;
drop trigger if exists capture_battle_monitor_history on public.battle_monitor_state;
create trigger capture_battle_monitor_history after insert or update on public.battle_monitor_state
for each row execute function public.capture_battle_monitor_history();
-- 僅在目前快照仍新鮮時記錄「現在」；不把 updated_at 當作過去歷史。
insert into public.battle_monitor_history(slot,captured_at,cities)
select date_trunc('minute',clock_timestamp()),clock_timestamp(),public.rf_history_public_cities(cities)
from public.battle_monitor_state where status->>'connected'='true'
  and updated_at > now()-interval '90 seconds' and jsonb_array_length(cities)>0
on conflict(slot) do nothing;
commit;
