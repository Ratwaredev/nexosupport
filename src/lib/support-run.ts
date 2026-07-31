import type { AgentActionResult } from './agent';
import type { DiagnosticReport } from './diagnostics';

export type SupportRunStatus = 'running' | 'waiting-confirmation' | 'completed' | 'needs-remote' | 'cancelled' | 'failed';

export type SupportRunAction = {
  tool: string;
  label: string;
  mode: 'read' | 'change' | 'support';
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  message: string;
  details: string[];
};

export type SupportRunReport = {
  kind: 'nexo-support-run';
  schemaVersion: 1;
  runId: string;
  issue: string;
  status: SupportRunStatus;
  createdAt: string;
  completedAt?: string;
  before?: DiagnosticReport | null;
  after?: DiagnosticReport | null;
  actions: SupportRunAction[];
  summary: string;
  recommendations: string[];
  remote?: { rustdeskId?: string | null; requestCode?: string | null };
};

export function createSupportRun(issue: string): SupportRunReport {
  const now = new Date().toISOString();
  return {
    kind: 'nexo-support-run',
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    issue: issue.trim().slice(0, 600),
    status: 'running',
    createdAt: now,
    actions: [],
    summary: 'Revisión iniciada.',
    recommendations: []
  };
}

export function actionFromResult(
  tool: string,
  label: string,
  mode: SupportRunAction['mode'],
  startedAt: string,
  result: AgentActionResult
): SupportRunAction {
  return {
    tool,
    label,
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: result.ok,
    message: result.message,
    details: result.details.slice(0, 8).map((detail) => String(detail).slice(0, 8000))
  };
}

export function diagnosticDelta(before?: DiagnosticReport | null, after?: DiagnosticReport | null) {
  if (!before || !after) return [] as string[];
  const rows: string[] = [];
  const freed = Number((after.systemDriveFreeGb - before.systemDriveFreeGb).toFixed(1));
  if (Math.abs(freed) >= 0.1) rows.push(`${freed > 0 ? '+' : ''}${freed} GB libres`);
  const ram = Number((after.ramFreeGb - before.ramFreeGb).toFixed(1));
  if (Math.abs(ram) >= 0.1) rows.push(`${ram > 0 ? '+' : ''}${ram} GB RAM libre`);
  const startup = after.startupItems - before.startupItems;
  if (startup !== 0) rows.push(`${startup > 0 ? '+' : ''}${startup} programas de inicio`);
  if (before.pendingReboot !== after.pendingReboot) rows.push(after.pendingReboot ? 'Reinicio pendiente' : 'Sin reinicio pendiente');
  return rows;
}

export function buildRunSummary(report: SupportRunReport) {
  const successfulChanges = report.actions.filter((action) => action.mode === 'change' && action.ok).length;
  const failed = report.actions.filter((action) => !action.ok).length;
  const delta = diagnosticDelta(report.before, report.after);
  if (report.status === 'needs-remote') return 'Requiere asistencia remota.';
  if (report.status === 'cancelled') return 'La persona canceló los cambios.';
  if (failed) return `${failed} acción${failed === 1 ? '' : 'es'} no se pudo completar.`;
  if (successfulChanges && delta.length) return `Listo: ${delta.join(' · ')}`;
  if (successfulChanges) return 'Cambios aplicados y verificados.';
  return 'Revisión terminada.';
}

export function isSupportRunPayload(value: unknown): value is SupportRunReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SupportRunReport>;
  return candidate.kind === 'nexo-support-run' && candidate.schemaVersion === 1 && typeof candidate.runId === 'string';
}
