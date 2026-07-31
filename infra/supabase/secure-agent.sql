-- Run after schema.sql and nexo-assistant.sql.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  case_id text not null unique,
  problem text not null,
  status text not null check (status in ('running','resolved','needs-support','cancelled','failed')),
  report jsonb not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_audit_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  action text not null,
  mode text not null check (mode in ('read','confirm','support')),
  status text not null check (status in ('planned','running','done','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
alter table public.agent_audit_events enable row level security;

create policy "agent runs admin read" on public.agent_runs for select
using (public.is_admin());
create policy "agent audit admin read" on public.agent_audit_events for select
using (public.is_admin());

create or replace function public.save_agent_report(
  p_device_token text,
  p_report jsonb
)
returns public.agent_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.devices;
  run_row public.agent_runs;
  report_case_id text;
  report_status text;
begin
  select * into device_row from public.devices where device_token = p_device_token;
  if not found then raise exception 'invalid device token'; end if;

  report_case_id := left(coalesce(p_report->>'caseId', ''), 120);
  report_status := coalesce(p_report->>'status', 'running');
  if report_case_id = '' then raise exception 'missing case id'; end if;
  if report_status not in ('running','resolved','needs-support','cancelled','failed') then raise exception 'invalid report status'; end if;

  insert into public.agent_runs(device_id, case_id, problem, status, report, started_at, finished_at, updated_at)
  values (
    device_row.id,
    report_case_id,
    left(coalesce(p_report->>'problem', ''), 500),
    report_status,
    p_report,
    coalesce((p_report->>'startedAt')::timestamptz, now()),
    case when p_report ? 'finishedAt' then (p_report->>'finishedAt')::timestamptz else null end,
    now()
  )
  on conflict (case_id) do update set
    status = excluded.status,
    report = excluded.report,
    finished_at = excluded.finished_at,
    updated_at = now()
  where public.agent_runs.device_id = device_row.id
  returning * into run_row;

  if run_row.device_id <> device_row.id then raise exception 'report ownership mismatch'; end if;
  return run_row;
end;
$$;

-- A device may only create a remote session for its own ticket.
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
  select * into device_row from public.devices where device_token = p_device_token;
  if not found then raise exception 'invalid device token'; end if;

  select * into ticket_row from public.tickets
  where id = p_ticket_id and device_id = device_row.id;
  if not found then raise exception 'invalid ticket for device'; end if;

  session_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.sessions(ticket_id, device_id, code, instructions)
  values (ticket_row.id, device_row.id, session_code, 'Sesión autorizada por el usuario.')
  returning * into session_row;

  update public.tickets set remote_code = session_code, status = 'en-remoto', updated_at = now()
  where id = ticket_row.id and device_id = device_row.id;
  update public.devices set status = 'en-remoto', updated_at = now() where id = device_row.id;
  return session_row;
end;
$$;
