import type { DiagnosticReport } from './diagnostics';
import type { HardwareSnapshot } from './sensors';
import type { AgentActionResult } from './agent';
import { optimizeTempFiles, runAgentAction } from './agent';
import { runQuickDiagnostic } from './diagnostics';
import { readHardwareSensors, summarizeHardware } from './sensors';
import { requestAssistant } from './assistant';
import type { AssistantToolId, ProviderMessage } from './assistant';

export type SafeToolMode = 'read' | 'confirm' | 'support';
export type AgentStepStatus = 'planned' | 'running' | 'done' | 'failed' | 'cancelled';

export type AgentStep = {
  id: string;
  tool: AssistantToolId;
  label: string;
  mode: SafeToolMode;
  status: AgentStepStatus;
  startedAt?: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
};

export type AgentReport = {
  kind: 'nexo-agent-report';
  version: 1;
  caseId: string;
  deviceId: string;
  problem: string;
  status: 'running' | 'resolved' | 'needs-support' | 'cancelled' | 'failed';
  startedAt: string;
  finishedAt?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  summary?: string;
  steps: AgentStep[];
};

export type PendingAction = {
  callId: string;
  tool: AssistantToolId;
  label: string;
  description: string;
  mode: SafeToolMode;
};

const CATALOG: Record<AssistantToolId, { label: string; description: string; mode: SafeToolMode }> = {
  run_quick_diagnostic: { label: 'Revisar PC', description: 'Lee rendimiento, disco y estado de Windows.', mode: 'read' },
  network_check: { label: 'Revisar Internet', description: 'Comprueba red, DNS y salida a Internet.', mode: 'read' },
  scan_temp_files: { label: 'Medir temporales', description: 'Calcula espacio recuperable sin borrar.', mode: 'read' },
  startup_review: { label: 'Revisar inicio', description: 'Lista programas que arrancan con Windows.', mode: 'read' },
  defender_status: { label: 'Revisar seguridad', description: 'Lee Microsoft Defender.', mode: 'read' },
  clean_temp_files: { label: 'Limpiar temporales', description: 'Borra solo temporales antiguos autorizados.', mode: 'confirm' },
  repair_network: { label: 'Reparar DNS', description: 'Limpia la caché DNS de Windows.', mode: 'confirm' },
  defender_quick_scan: { label: 'Analizar con Defender', description: 'Inicia un análisis rápido oficial.', mode: 'confirm' },
  open_windows_update: { label: 'Abrir Windows Update', description: 'Abre la pantalla oficial de actualizaciones.', mode: 'confirm' },
  remote_support: { label: 'Pedir soporte remoto', description: 'Prepara una solicitud visible de asistencia.', mode: 'support' }
};

const allowedTools = new Set<AssistantToolId>(Object.keys(CATALOG) as AssistantToolId[]);
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function parseDetails(result: AgentActionResult): Record<string, unknown> {
  const details = result.details.flatMap((item) => {
    try { return [JSON.parse(item) as unknown]; } catch { return [item]; }
  });
  return { ok: result.ok, message: result.message, details };
}

export function createReport(deviceId: string, problem: string): AgentReport {
  return {
    kind: 'nexo-agent-report',
    version: 1,
    caseId: id('case'),
    deviceId,
    problem: problem.slice(0, 500),
    status: 'running',
    startedAt: now(),
    steps: []
  };
}

export function pendingFromMessage(message: ProviderMessage): PendingAction | null {
  const call = message.tool_calls?.[0];
  if (!call || !allowedTools.has(call.function.name)) return null;
  const tool = call.function.name;
  const definition = CATALOG[tool];
  return { callId: call.id, tool, ...definition };
}

export async function askAgent(input: {
  deviceToken: string;
  messages: ProviderMessage[];
  diagnostic?: DiagnosticReport | null;
  hardware?: HardwareSnapshot | null;
  appVersion: string;
}) {
  return requestAssistant({
    deviceToken: input.deviceToken,
    messages: input.messages,
    diagnostic: input.diagnostic,
    hardware: input.hardware ? summarizeHardware(input.hardware) : null,
    agentStatus: null,
    appVersion: input.appVersion
  });
}

export async function executeSafeTool(
  tool: AssistantToolId,
  onProgress?: (percent: number) => void
): Promise<Record<string, unknown>> {
  if (!allowedTools.has(tool)) throw new Error('Acción no permitida.');
  if (tool === 'run_quick_diagnostic') {
    const [diagnostic, hardware] = await Promise.all([
      runQuickDiagnostic(),
      readHardwareSensors(false).catch(() => null)
    ]);
    return { diagnostic, hardware };
  }
  if (tool === 'clean_temp_files') {
    const result = await optimizeTempFiles((progress) => onProgress?.(progress.percent));
    return parseDetails(result);
  }
  const actionMap: Partial<Record<AssistantToolId, string>> = {
    network_check: 'network_check',
    scan_temp_files: 'temp_scan',
    startup_review: 'startup_review',
    defender_status: 'defender_status',
    repair_network: 'repair_network',
    defender_quick_scan: 'defender_quick_scan',
    open_windows_update: 'open_windows_update'
  };
  const action = actionMap[tool];
  if (!action) return { supportRequested: tool === 'remote_support' };
  return parseDetails(await runAgentAction(action));
}

export function addPlannedStep(report: AgentReport, action: PendingAction): AgentReport {
  return {
    ...report,
    steps: [...report.steps, {
      id: action.callId || id('step'),
      tool: action.tool,
      label: action.label,
      mode: action.mode,
      status: 'planned'
    }]
  };
}

export function updateStep(
  report: AgentReport,
  stepId: string,
  patch: Partial<AgentStep>
): AgentReport {
  return {
    ...report,
    steps: report.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step)
  };
}

export function finishReport(
  report: AgentReport,
  status: AgentReport['status'],
  summary: string,
  after?: Record<string, unknown>
): AgentReport {
  return { ...report, status, summary: summary.slice(0, 1200), after, finishedAt: now() };
}

export function safeToolResultMessage(callId: string, tool: AssistantToolId, result: Record<string, unknown>): ProviderMessage {
  return {
    role: 'tool',
    tool_call_id: callId,
    name: tool,
    content: JSON.stringify(result).slice(0, 12000)
  };
}
