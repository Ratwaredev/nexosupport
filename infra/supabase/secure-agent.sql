-- Run after infra/supabase/schema.sql and infra/supabase/nexo-assistant.sql.

create index if not exists diagnostics_device_generated_idx
on public.diagnostics(device_id, generated_at desc);

create index if not exists tickets_device_updated_idx
on public.tickets(device_id, updated_at desc);

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

revoke all on function public.create_remote_session(text, text) from public;
grant execute on function public.create_remote_session(text, text) to anon, authenticated;

-- Fresh restore trigger after repository secret update: 2026-08-01.
