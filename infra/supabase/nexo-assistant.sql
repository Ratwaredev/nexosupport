-- NEXO Support product layer. Run after infra/supabase/schema.sql.

create table if not exists public.support_users (
  id uuid primary key default gen_random_uuid(),
  org_name text not null,
  full_name text not null,
  email text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  default_plan text not null default 'basic',
  default_model text,
  monthly_message_limit integer,
  is_staff boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists support_users_org_email_unique
on public.support_users(org_name, lower(email)) where email is not null;

alter table public.pairing_codes add column if not exists support_user_id uuid references public.support_users(id) on delete set null;
alter table public.devices add column if not exists support_user_id uuid references public.support_users(id) on delete set null;
create index if not exists devices_support_user_id_idx on public.devices(support_user_id);

create table if not exists public.device_entitlements (
  device_id uuid primary key references public.devices(id) on delete cascade,
  status text not null default 'inactive' check (status in ('inactive', 'active', 'suspended')),
  plan text not null default 'basic',
  model text,
  monthly_message_limit integer,
  messages_used integer not null default 0 check (messages_used >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_consents (
  device_id uuid primary key references public.devices(id) on delete cascade,
  assistant_enabled boolean not null default false,
  share_diagnostics boolean not null default false,
  automatic_checks boolean not null default false,
  hardware_sensors boolean not null default false,
  elevated_sensors boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.support_users enable row level security;
alter table public.device_entitlements enable row level security;
alter table public.device_consents enable row level security;

drop policy if exists "support users admin access" on public.support_users;
create policy "support users admin access" on public.support_users for all
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "device entitlements admin read" on public.device_entitlements;
drop policy if exists "device entitlements admin write" on public.device_entitlements;
create policy "device entitlements admin access" on public.device_entitlements for all
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "device consents admin read" on public.device_consents;
create policy "device consents admin read" on public.device_consents for select
using (public.is_admin());

create or replace function public.create_default_device_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_status text := 'active';
  user_plan text := 'basic';
  user_model text := null;
  user_limit integer := 200;
begin
  if new.support_user_id is not null then
    select status, default_plan, default_model, monthly_message_limit
    into user_status, user_plan, user_model, user_limit
    from public.support_users
    where id = new.support_user_id;
  end if;

  insert into public.device_entitlements(
    device_id,
    status,
    plan,
    model,
    monthly_message_limit
  ) values (
    new.id,
    case when user_status = 'suspended' then 'suspended' else 'active' end,
    coalesce(user_plan, 'basic'),
    user_model,
    coalesce(user_limit, 200)
  ) on conflict (device_id) do nothing;

  insert into public.device_consents(device_id)
  values (new.id)
  on conflict (device_id) do nothing;

  return new;
end;
$$;

drop trigger if exists devices_create_entitlement on public.devices;
create trigger devices_create_entitlement
after insert on public.devices
for each row execute function public.create_default_device_entitlement();

insert into public.device_entitlements(device_id, status, plan, monthly_message_limit)
select id, 'active', 'basic', 200 from public.devices
on conflict (device_id) do nothing;

insert into public.device_consents(device_id)
select id from public.devices
on conflict (device_id) do nothing;

-- Creates the staff member as a normal support user too. This does not replace auth/admin_users.
insert into public.support_users(org_name, full_name, email, status, default_plan, monthly_message_limit, is_staff)
select a.org_name, split_part(a.email, '@', 1), a.email, 'active', 'pro', 1000, true
from public.admin_users a
where not exists (
  select 1 from public.support_users u
  where u.org_name = a.org_name and lower(u.email) = lower(a.email)
);

create or replace function public.generate_user_pairing_code(p_support_user_id uuid default null)
returns public.pairing_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  org_name_value text;
  generated_code text;
  selected_user public.support_users;
  row_result public.pairing_codes;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select org_name into org_name_value from public.admin_users where user_id = auth.uid();

  if p_support_user_id is not null then
    select * into selected_user from public.support_users
    where id = p_support_user_id and org_name = org_name_value;
    if not found then raise exception 'support user not found'; end if;
  end if;

  generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.pairing_codes(code, org_name, support_user_id, expires_at)
  values (generated_code, org_name_value, p_support_user_id, now() + interval '30 minutes')
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
  select * into pairing_row from public.pairing_codes
  where code = upper(p_pairing_code)
    and claimed_at is null
    and expires_at > now();
  if not found then raise exception 'invalid pairing code'; end if;

  device_token_value := encode(gen_random_bytes(24), 'hex');
  insert into public.devices(
    org_name, support_user_id, display_name, computer_name, user_name, os,
    platform, pairing_code, device_token, status
  ) values (
    pairing_row.org_name, pairing_row.support_user_id, p_device_name, p_computer_name,
    p_user_name, p_os, p_platform, pairing_row.code, device_token_value, 'idle'
  ) returning * into device_row;

  update public.pairing_codes
  set claimed_at = now(), claimed_device_id = device_row.id
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

create or replace function public.set_device_consents(
  p_device_token text,
  p_assistant_enabled boolean,
  p_share_diagnostics boolean,
  p_automatic_checks boolean,
  p_hardware_sensors boolean,
  p_elevated_sensors boolean
)
returns public.device_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.devices;
  consent_row public.device_consents;
begin
  select * into device_row from public.devices where device_token = p_device_token;
  if not found then raise exception 'invalid device token'; end if;

  insert into public.device_consents(
    device_id, assistant_enabled, share_diagnostics, automatic_checks,
    hardware_sensors, elevated_sensors, updated_at
  ) values (
    device_row.id, p_assistant_enabled, p_share_diagnostics, p_automatic_checks,
    p_hardware_sensors, p_elevated_sensors, now()
  ) on conflict (device_id) do update set
    assistant_enabled = excluded.assistant_enabled,
    share_diagnostics = excluded.share_diagnostics,
    automatic_checks = excluded.automatic_checks,
    hardware_sensors = excluded.hardware_sensors,
    elevated_sensors = excluded.elevated_sensors,
    updated_at = now()
  returning * into consent_row;
  return consent_row;
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
  consent_json jsonb;
  entitlement_json jsonb;
begin
  select * into device_row from public.devices where device_token = p_device_token;
  if not found then raise exception 'invalid device token'; end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb)
  into tickets_json from public.tickets t where t.device_id = device_row.id;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.generated_at desc), '[]'::jsonb)
  into diagnostics_json from public.diagnostics d where d.device_id = device_row.id;

  select to_jsonb(r) into release_json from public.releases r
  where r.is_active = true order by r.published_at desc limit 1;

  select to_jsonb(s) into session_json from public.sessions s
  where s.device_id = device_row.id order by s.created_at desc limit 1;

  select to_jsonb(c) into consent_json from public.device_consents c where c.device_id = device_row.id;
  select to_jsonb(e) into entitlement_json from public.device_entitlements e where e.device_id = device_row.id;

  update public.devices set last_seen_at = now(), updated_at = now() where id = device_row.id;

  return jsonb_build_object(
    'device', to_jsonb(device_row),
    'consent', consent_json,
    'entitlement', entitlement_json,
    'tickets', tickets_json,
    'diagnostics', diagnostics_json,
    'latestRelease', release_json,
    'latestSession', session_json
  );
end;
$$;
