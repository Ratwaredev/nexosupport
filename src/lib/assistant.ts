import type { DiagnosticReport } from './diagnostics';
import type { AgentActionResult, AgentStatus } from './agent';
import type { HardwareSnapshot, SensorSummary } from './sensors';

export type AssistantToolId =
  | 'run_quick_diagnostic'
  | 'network_check'
  | 'scan_temp_files'
  | 'startup_review'
  | 'defender_status'
  | 'clean_temp_files'
  | 'repair_network'
  | 'defender_quick_scan'
  | 'open_windows_update'
  | 'remote_support';

export type ToolMode = 'read' | 'confirm' | 'support';
export type ToolDefinition = { id: AssistantToolId; label: string; description: string; mode: ToolMode; progressLabel: string };

export const TOOL_CATALOG: Record<AssistantToolId, ToolDefinition> = {
  run_quick_diagnostic: { id: 'run_quick_diagnostic', label: 'Revisar esta PC', description: 'Lee rendimiento, disco, seguridad y sensores autorizados. No modifica nada.', mode: 'read', progressLabel: 'Revisando el equipo' },
  network_check: { id: 'network_check', label: 'Revisar Internet', description: 'Comprueba conexión, DNS y puerta de enlace. No cambia la red.', mode: 'read', progressLabel: 'Revisando la conexión' },
  scan_temp_files: { id: 'scan_temp_files', label: 'Buscar temporales', description: 'Calcula cuánto espacio ocupan. No borra archivos.', mode: 'read', progressLabel: 'Buscando temporales' },
  startup_review: { id: 'startup_review', label: 'Revisar el inicio', description: 'Lista programas que arrancan con Windows. No desactiva nada.', mode: 'read', progressLabel: 'Revisando el inicio' },
  defender_status: { id: 'defender_status', label: 'Revisar seguridad', description: 'Lee el estado de Microsoft Defender.', mode: 'read', progressLabel: 'Revisando la seguridad' },
  clean_temp_files: { id: 'clean_temp_files', label: 'Liberar espacio', description: 'Borra únicamente temporales antiguos del usuario.', mode: 'confirm', progressLabel: 'Limpiando temporales' },
  repair_network: { id: 'repair_network', label: 'Reparar conexión', description: 'Limpia la caché DNS de Windows.', mode: 'confirm', progressLabel: 'Reparando la conexión' },
  defender_quick_scan: { id: 'defender_quick_scan', label: 'Análisis de seguridad', description: 'Inicia un análisis rápido oficial de Microsoft Defender.', mode: 'confirm', progressLabel: 'Iniciando el análisis' },
  open_windows_update: { id: 'open_windows_update', label: 'Abrir actualizaciones', description: 'Abre Windows Update para que controles la instalación.', mode: 'confirm', progressLabel: 'Abriendo Windows Update' },
  remote_support: { id: 'remote_support', label: 'Hablar con un técnico', description: 'Crea una solicitud y prepara una conexión remota autorizada.', mode: 'support', progressLabel: 'Preparando asistencia' }
};

export type ProviderToolCall = { id: string; type: 'function'; function: { name: AssistantToolId; arguments: string } };
export type ProviderMessage = { role: 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ProviderToolCall[]; tool_call_id?: string; name?: AssistantToolId };

export type AssistantRequest = {
  deviceToken: string;
  messages: ProviderMessage[];
  diagnostic?: DiagnosticReport | null;
  hardware?: SensorSummary | null;
  agentStatus?: AgentStatus | null;
  appVersion: string;
};

export type AssistantResponse = { message: ProviderMessage; entitlement?: { plan: string; remaining: number | null } };

const apiUrl = (import.meta.env.VITE_NEXO_API_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
const lastUserText = (messages: ProviderMessage[]) => [...messages].reverse().find((message) => message.role === 'user')?.content?.toLowerCase() ?? '';
const lastTool = (messages: ProviderMessage[]) => messages[messages.length - 1]?.role === 'tool' ? messages[messages.length - 1] : undefined;

function localToolCall(name: AssistantToolId): AssistantResponse {
  return { message: { role: 'assistant', content: null, tool_calls: [{ id: `local-${Date.now()}`, type: 'function', function: { name, arguments: '{}' } }] }, entitlement: { plan: 'demo', remaining: null } };
}

function localFallback(messages: ProviderMessage[]): AssistantResponse {
  const tool = lastTool(messages);
  if (tool) {
    let parsed: { ok?: boolean; message?: string } | null = null;
    try { parsed = JSON.parse(tool.content ?? '{}') as { ok?: boolean; message?: string }; } catch { parsed = null; }
    return { message: { role: 'assistant', content: parsed?.ok === false ? 'No pude completar esa acción. No hice otros cambios.' : `${parsed?.message || 'La revisión terminó.'} ¿Querés revisar otra cosa?` }, entitlement: { plan: 'demo', remaining: null } };
  }
  const text = lastUserText(messages);
  if (/internet|wifi|wi-fi|red|conexi[oó]n|navega/.test(text)) return localToolCall('network_check');
  if (/virus|seguridad|defender|malware|antivirus/.test(text)) return localToolCall('defender_status');
  if (/espacio|disco lleno|basura|temporales|limpiar/.test(text)) return localToolCall('scan_temp_files');
  if (/inicio|arranca|prende lento|tarda en iniciar/.test(text)) return localToolCall('startup_review');
  if (/t[eé]cnico|persona|humano|remoto/.test(text)) return localToolCall('remote_support');
  if (/temperatura|calor|caliente|lenta|lento|colgada|congela|revisar|diagn[oó]stico|pc/.test(text)) return localToolCall('run_quick_diagnostic');
  return { message: { role: 'assistant', content: 'Decime qué notás: lentitud, Internet, temperatura, seguridad o algún error.' }, entitlement: { plan: 'demo', remaining: null } };
}

export async function requestAssistant(input: AssistantRequest): Promise<AssistantResponse> {
  if (!apiUrl || !input.deviceToken) {
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    return localFallback(input.messages);
  }
  const response = await fetch(`${apiUrl}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.deviceToken}` },
    body: JSON.stringify({
      messages: input.messages.slice(-24),
      diagnostic: input.diagnostic ?? null,
      hardware: input.hardware ?? null,
      agentStatus: input.agentStatus ?? null,
      appVersion: input.appVersion
    })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || 'NEXO no pudo responder en este momento.');
  }
  return response.json() as Promise<AssistantResponse>;
}

export function normalizeToolResult(result: AgentActionResult | DiagnosticReport | HardwareSnapshot | Record<string, unknown>) {
  return JSON.stringify(result);
}
