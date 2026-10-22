-- Sento live sync. Paste into Supabase → SQL Editor → Run.
--
-- One row per favourite / visit / names record, grouped by a private household
-- code that only your two phones know. The table itself is locked; the app can
-- only call sento_sync(), which requires the code.

create table if not exists public.sento_records (
  household text not null,
  id text not null,
  kind text not null,
  data jsonb,
  u bigint not null,            -- client edit time (ms); newest edit wins
  deleted boolean not null default false,
  primary key (household, id)
);

alter table public.sento_records enable row level security;
revoke all on table public.sento_records from anon, authenticated;

-- Push local changes, get back everything for the household.
create or replace function public.sento_sync(p_household text, p_changes jsonb default '[]')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if p_household is null or length(p_household) not between 16 and 64 then
    raise exception 'invalid household code';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 2000 then
    raise exception 'invalid changes';
  end if;

  for r in select * from jsonb_array_elements(p_changes) loop
    insert into sento_records (household, id, kind, data, u, deleted)
    values (
      p_household,
      r->>'id',
      coalesce(r->>'kind', 'gone'),
      case when coalesce((r->>'deleted')::boolean, false) then null else r->'data' end,
      (r->>'u')::bigint,
      coalesce((r->>'deleted')::boolean, false)
    )
    on conflict (household, id) do update set
      kind = case when excluded.deleted then sento_records.kind else excluded.kind end,
      data = excluded.data,
      u = excluded.u,
      deleted = excluded.deleted
    where excluded.u > sento_records.u;
  end loop;

  return coalesce(
    (select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'data', data, 'u', u, 'deleted', deleted))
       from sento_records where household = p_household),
    '[]'::jsonb);
end;
$$;

revoke execute on function public.sento_sync(text, jsonb) from public;
grant execute on function public.sento_sync(text, jsonb) to anon, authenticated;
