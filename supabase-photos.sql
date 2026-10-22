-- Sento photo diary (さっぱり). Paste into Supabase → SQL Editor → Run.
-- Run after supabase.sql.
--
-- Photos are stored as small JPEGs (a grid thumbnail and a larger image),
-- grouped by your private household code. The table is locked; the app can
-- only use the three functions below, which all require the code.

create table if not exists public.sento_photos (
  household text not null,
  id text not null,
  thumb text not null,          -- base64 JPEG, ~360px
  image text not null,          -- base64 JPEG, ~1280px
  created_at timestamptz not null default now(),
  primary key (household, id)
);

alter table public.sento_photos enable row level security;
revoke all on table public.sento_photos from anon, authenticated;

create or replace function public.sento_photo_put(p_household text, p_id text, p_thumb text, p_image text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_household is null or length(p_household) not between 16 and 64 then
    raise exception 'invalid household code';
  end if;
  if p_id is null or length(p_id) not between 1 and 64 then
    raise exception 'invalid photo id';
  end if;
  if length(p_thumb) > 300000 or length(p_image) > 3000000 then
    raise exception 'photo too large';
  end if;
  insert into sento_photos (household, id, thumb, image)
  values (p_household, p_id, p_thumb, p_image)
  on conflict (household, id) do nothing;
end;
$$;

create or replace function public.sento_photo_get(p_household text, p_id text, p_full boolean default false)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p_full then image else thumb end
  from sento_photos
  where household = p_household and id = p_id;
$$;

create or replace function public.sento_photo_delete(p_household text, p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from sento_photos where household = p_household and id = p_id;
$$;

revoke execute on function public.sento_photo_put(text, text, text, text) from public;
revoke execute on function public.sento_photo_get(text, text, boolean) from public;
revoke execute on function public.sento_photo_delete(text, text) from public;
grant execute on function public.sento_photo_put(text, text, text, text) to anon, authenticated;
grant execute on function public.sento_photo_get(text, text, boolean) to anon, authenticated;
grant execute on function public.sento_photo_delete(text, text) to anon, authenticated;
