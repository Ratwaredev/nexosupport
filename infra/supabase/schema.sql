-- Fresh schema restore after the NEXO Control window repair.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  org_name text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table if not exists public.pairing_codes (
  code text primary key,
  org_name text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_device_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  org_name text not null,
  display_name text not null,
  computer_name text not null,
  user_name text not null,
  os text not null,
  platform text not null,
  pairing_code text,
  device_token text not null unique,
  status text not null default 'idle',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id text primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  client_name text not null,
  issue text not null,
  status text not null default 'nuevo',
  priority text not null default 'normal',
  remote_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  generated_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null references public.tickets(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  code text not null,
  expires_in_minutes integer not null default 20,
  instructions text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.releases (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'stable',
  version text not null,
  notes text not null,
  manifest_url text not null,
  signature text not null,
  published_at timestamptz not null default now(),
  is_active boolean not null default true
);

alter table public.admin_users enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.devices enable row level security;
alter table public.tickets enable row level security;
alter table public.diagnostics enable row level security;
alter table public.sessions enable row level security;
alter table public.releases enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;

create policy "admin users self read"
on public.admin_users
for select
using (user_id = auth.uid());

create policy "admin users self insert"
on public.admin_users
for insert
with check (user_id = auth.uid());

create policy "pairing codes admin only"
on public.pairing_codes
for all
using (public.is_admin())
with check (public.is_admin());

create policy "devices admin read"
on public.devices
for select
using (public.is_admin());

create policy "devices admin update"
on public.devices
for update
using (public.is_admin())
with check (public.is_admin());

create policy "devices admin insert"
on public.devices
for insert
with check (public.is_admin());

create policy "tickets admin read"
on public.tickets
for select
using (public.is_admin());

create policy "tickets admin write"
on public.tickets
for all
using (public.is_admin())
with check (public.is_admin());

create policy "diagnostics admin read"
on public.diagnostics
for select
using (public.is_admin());

create policy "diagnostics admin write"
on public.diagnostics
for all
using (public.is_admin())
with check (public.is_admin());

create policy "sessions admin read"
on public.sessions
for select
using (public.is_admin());

create policy "sessions admin write"
on public.sessions
for all
using (public.is_admin())
with check (public.is_admin());

create policy "releases public read"
on public.releases
for select
using (true);

create or replace function public.generate_pairing_code()
returns public.pairing_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  org_name_value text;
  generated_code text;
  row_result public.pairing_codes;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select org_name into org_name_value
  from public.admin_users
  where user_id = auth.uid();

  generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.pairing_codes(code, org_name, expires_at)
  values (generated_code, coalesce(org_name_value, 'UnderDock'), now() + interval '30 minutes')
  returning * into row_result;

  return row_result;
end;
$$;

create or replace function public.register_device(
  p_pairing_code text,
  p_device_name text,
  p_computer_name text,
  p_user_name text,
  p_os text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing_row public.pairing_codes;
  device_row public.devices;
  device_token_value text;
begin
  select * into pairing_row
  from public.pairing_codes
  where code = upper(p_pairing_code)
    and claimed_at is null
    and expires_at > now();

  if not found then
    raise exception 'invalid pairing code';
  end if;

  device_token_value := encode(gen_random_bytes(16), 'hex');

  insert into public.devices(
    org_name,
    display_name,
    computer_name,
    user_name,
    os,
    platform,
    pairing_code,
    device_token,
    status
  )
  values (
    pairing_row.org_name,
    p_device_name,
    p_computer_name,
    p_user_name,
    p_os,
    p_platform,
    pairing_row.code,
    device_token_value,
    'waiting'
  )
  returning * into device_row;

  update public.pairing_codes
  set claimed_at = now(),
      claimed_device_id = device_row.id
  where code = pairing_row.code;

  return jsonb_build_object(
    'device', to_jsonb(device_row),
    'session', jsonb_build_object(
      'role', 'client',
      'backendKind', 'supabase',
      'deviceId', device_row.id,
      'deviceToken', device_row.device_token,
      'displayName', device_row.display_name,
      'orgName', device_row.org_name
    )
  );
end;
$$;

create or replace function public.create_ticket(
  p_device_token text,
  p_issue text,
  p_client_name text,
  p_priority text default 'normal'
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.devices;
  ticket_row public.tickets;
  ticket_id_value text;
begin
  select * into device_row
  from public.devices
  where public.devices.device_token = p_device_token;

  if not found then
    raise exception 'invalid device token';
  end if;

  ticket_id_value := 'UD-' || floor(random() * 9000 + 1000)::int::text;

  insert into public.tickets(id, device_id, client_name, issue, status, priority, updated_at)
  values (ticket_id_value, device_row.id, p_client_name, p_issue, 'nuevo', coalesce(p_priority, 'normal'), now())
  returning * into ticket_row;

  update public.devices
  set status = 'waiting',
      updated_at = now()
  where id = device_row.id;

  return ticket_row;
end;
$$;

create or replace function public.save_diagnostic(
  p_device_token text,
  p_diagnostic jsonb
)
returns public.diagnostics
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.devices;
  diagnostic_row public.diagnostics;
begin
  select * into device_row
  from public.devices
  where public.devices.device_token = p_device_token;

  if not found then
    raise exception 'invalid device token';
  end if;

  insert into public.diagnostics(device_id, payload)
  values (device_row.id, p_diagnostic)
  returning * into diagnostic_row;

  update public.devices
  set last_seen_at = diagnostic_row.generated_at,
      updated_at = diagnostic_row.generated_at
  where id = device_row.id;

  return diagnostic_row;
end;
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
  where public.devices.device_token = p_device_token;

  if not found then
    raise exception 'invalid device token';
  end if;

  select * into ticket_row
  from public.tickets
  where id = p_ticket_id;

  if not found then
    raise exception 'invalid ticket';
  end if;

  session_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.sessions(ticket_id, device_id, code, instructions)
  values (
    ticket_row.id,
    device_row.id,
    session_code,
    'Comparti este codigo con el tecnico. No requiere dejar la PC monitoreando: solo se usa para abrir la sesion de soporte.'
  )
  returning * into session_row;

  update public.tickets
  set remote_code = session_code,
      status = 'en-remoto',
      updated_at = now()
  where id = ticket_row.id;

  update public.devices
  set status = 'en-remoto',
      updated_at = now()
  where id = device_row.id;

  return session_row;
end;
$$;

create or replace function public.get_client_dashboard(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.devices;
  tickets_json jsonb;
  diagnostics_json jsonb;
  release_json jsonb;
  session_json jsonb;
begin
  select * into device_row
  from public.devices
  where public.devices.device_token = p_device_token;

  if not found then
    raise exception 'invalid device token';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb) into tickets_json
  from public.tickets t
  where t.device_id = device_row.id;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.generated_at desc), '[]'::jsonb) into diagnostics_json
  from public.diagnostics d
  where d.device_id = device_row.id;

  select to_jsonb(r) into release_json
  from public.releases r
  where r.is_active = true
  order by r.published_at desc
  limit 1;

  select to_jsonb(s) into session_json
  from public.sessions s
  where s.device_id = device_row.id
  order by s.created_at desc
  limit 1;

  return jsonb_build_object(
    'device', to_jsonb(device_row),
    'tickets', tickets_json,
    'diagnostics', diagnostics_json,
    'latestRelease', release_json,
    'latestSession', session_json
  );
end;
$$;
