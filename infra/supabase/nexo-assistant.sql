-- NEXO Assistant entitlements. Run after infra/supabase/schema.sql.
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

alter table public.device_entitlements enable row level security;

create policy "device entitlements admin read"
on public.device_entitlements for select
using (public.is_admin());

create policy "device entitlements admin write"
on public.device_entitlements for all
using (public.is_admin())
with check (public.is_admin());

create or replace function public.create_default_device_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.device_entitlements(device_id, status, plan, monthly_message_limit)
  values (new.id, 'inactive', 'basic', 0)
  on conflict (device_id) do nothing;
  return new;
end;
$$;

drop trigger if exists devices_create_entitlement on public.devices;
create trigger devices_create_entitlement
after insert on public.devices
for each row execute function public.create_default_device_entitlement();

insert into public.device_entitlements(device_id, status, plan, monthly_message_limit)
select id, 'inactive', 'basic', 0 from public.devices
on conflict (device_id) do nothing;

-- Ejemplo para habilitar una PC y elegir el modelo desde NEXO:
-- update public.device_entitlements
-- set status = 'active', plan = 'pro', model = 'openrouter/auto', monthly_message_limit = 500
-- where device_id = 'UUID_DEL_DISPOSITIVO';
