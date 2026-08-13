-- Run after infra/supabase/schema.sql and infra/supabase/nexo-assistant.sql.

create index if not exists diagnostics_device_generated_idx
on public.diagnostics(device_id, generated_at desc);

create index if not exists tickets_device_updated_idx
on public.tickets(device_id, updated_at desc);

create index if not exists pairing_codes_support_user_idx
on public.pairing_codes(support_user_id);

create index if not exists sessions_device_idx
on public.sessions(device_id);

create index if not exists sessions_ticket_idx
on public.sessions(ticket_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;

create or replace function public.create_remote_session(
  p_device_token text,
  p_ticket_id text
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.devices;
  ticket_row public.tickets;
  session_row public.sessions;
  session_code text;
begin
  select * into device_row
  from public.devices
  where device_token = p_device_token;

  if not found then
    raise exception 'invalid device token';
  end if;

  select * into ticket_row
  from public.tickets
  where id = p_ticket_id
    and device_id = device_row.id
    and status <> 'cerrado';

  if not found then
    raise exception 'invalid ticket for device';
  end if;

  session_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.sessions(ticket_id, device_id, code, expires_in_minutes, instructions)
  values (
    ticket_row.id,
    device_row.id,
    session_code,
    20,
    'La persona debe aceptar la conexión visible en RustDesk.'
  )
  returning * into session_row;

  update public.tickets
  set remote_code = session_code,
      status = 'en-remoto',
      updated_at = now()
  where id = ticket_row.id
    and device_id = device_row.id;

  update public.devices
  set status = 'en-remoto',
      updated_at = now()
  where id = device_row.id;

  return session_row;
end;
$$;

-- Public device-token RPCs stay callable from the desktop client. Admin-only
-- and trigger helpers do not need anonymous EXECUTE privileges.
revoke all on function public.create_remote_session(text, text) from public;
grant execute on function public.create_remote_session(text, text) to anon, authenticated;

revoke execute on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.generate_pairing_code() from public;
revoke execute on function public.generate_pairing_code() from anon;
grant execute on function public.generate_pairing_code() to authenticated;

revoke execute on function public.generate_user_pairing_code(uuid) from public;
revoke execute on function public.generate_user_pairing_code(uuid) from anon;
grant execute on function public.generate_user_pairing_code(uuid) to authenticated;

revoke execute on function public.create_default_device_entitlement() from public;
revoke execute on function public.create_default_device_entitlement() from anon;
revoke execute on function public.create_default_device_entitlement() from authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end
$$;

-- Avoid per-row auth.uid() initialization in the only policies that call it
-- directly. Other policies delegate through the stable is_admin() helper.
drop policy if exists "admin users self read" on public.admin_users;
create policy "admin users self read"
on public.admin_users
for select
using (user_id = (select auth.uid()));

drop policy if exists "admin users self insert" on public.admin_users;
create policy "admin users self insert"
on public.admin_users
for insert
with check (user_id = (select auth.uid()));

-- PostgREST requires SQL privileges in addition to RLS policies. Keep the
-- privileges minimal; the existing policies still decide which rows an admin
-- can read or change.
grant usage on schema public to authenticated;

revoke all on table public.admin_users from anon;
grant select on table public.admin_users to authenticated;

grant select, insert, update on table public.support_users to authenticated;
grant select on table public.devices to authenticated;
grant select, insert, update on table public.device_entitlements to authenticated;
grant select on table public.device_consents to authenticated;
grant select, update on table public.tickets to authenticated;
grant select on table public.diagnostics to authenticated;
grant select on table public.sessions to authenticated;
grant select on table public.pairing_codes to authenticated;
grant select on table public.releases to anon, authenticated;

-- Fail the migration instead of shipping another login that authenticates and
-- then dies with permission errors or reopens admin-only RPCs to anon.
do $$
begin
  if not has_table_privilege('authenticated', 'public.admin_users', 'select') then
    raise exception 'authenticated is missing SELECT on public.admin_users';
  end if;
  if not has_table_privilege('authenticated', 'public.support_users', 'select') then
    raise exception 'authenticated is missing SELECT on public.support_users';
  end if;
  if not has_table_privilege('authenticated', 'public.tickets', 'update') then
    raise exception 'authenticated is missing UPDATE on public.tickets';
  end if;
  if not has_function_privilege('authenticated', 'public.generate_user_pairing_code(uuid)', 'execute') then
    raise exception 'authenticated cannot generate pairing codes';
  end if;
  if has_function_privilege('anon', 'public.generate_user_pairing_code(uuid)', 'execute') then
    raise exception 'anon can execute admin pairing function';
  end if;
  if has_function_privilege('anon', 'public.generate_pairing_code()', 'execute') then
    raise exception 'anon can execute legacy admin pairing function';
  end if;
end
$$;
