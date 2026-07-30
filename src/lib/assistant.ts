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
  run_quick_diagnostic: { id: 'run_quick_diagnostic', label: 'Revisar esta PC', description: 'Lee RAM, disco, seguridad, inicio y sensores disponibles. No modifica nada.', mode: 'read', progressLabel: 'Revisando el equipo' },
  network_check: { id: 'network_check', label: 'Revisar Internet', description: 'Comprueba adaptador, DNS, gateway y salida a Internet. No cambia la red.', mode: 'read', progressLabel: 'Revisando la conexión' },
  scan_temp_files: { id: 'scan_temp_files', label: 'Analizar basura', description: 'Calcula cuánto espacio puede recuperarse dentro de ubicaciones temporales autorizadas. No borra archivos.', mode: 'read', progressLabel: 'Buscando basura segura' },
  startup_review: { id: 'startup_review', label: 'Revisar el inicio', description: 'Lista programas que arrancan con Windows. No desactiva nada.', mode: 'read', progressLabel: 'Revisando el inicio' },
  defender_status: { id: 'defender_status', label: 'Revisar seguridad', description: 'Lee el estado real de Microsoft Defender y la protección en tiempo real.', mode: 'read', progressLabel: 'Revisando la seguridad' },
  clean_temp_files: { id: 'clean_temp_files', label: 'Optimizar ahora', description: 'Borra solo temporales antiguos de una lista blanca. No toca cookies, sesiones, perfiles, historial ni contraseñas de navegadores.', mode: 'confirm', progressLabel: 'Optimizando' },
  repair_network: { id: 'repair_network', label: 'Reparar conexión', description: 'Limpia la caché DNS de Windows sin cambiar el router ni la contraseña Wi‑Fi.', mode: 'confirm', progressLabel: 'Reparando la conexión' },
  defender_quick_scan: { id: 'defender_quick_scan', label: 'Análisis de seguridad', description: 'Inicia un análisis rápido oficial de Microsoft Defender.', mode: 'confirm', progressLabel: 'Iniciando el análisis' },
  open_windows_update: { id: 'open_windows_update', label: 'Abrir actualizaciones', description: 'Abre Windows Update para que controles la instalación.', mode: 'confirm', progressLabel: 'Abriendo Windows Update' },
  remote_support: { id: 'remote_support', label: 'Soporte remoto', description: 'Comprueba si RustDesk está instalado y lo prepara para una conexión autorizada.', mode: 'support', progressLabel: 'Preparando asistencia' }
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
  if (/internet|wifi|wi-fi|red|conexi[oó]n|navega|dns|gateway/.test(text)) return localToolCall('network_check');
  if (/virus|seguridad|defender|malware|antivirus/.test(text)) return localToolCall('defender_status');
  if (/optimizar|optimizaci[oó]n|espacio|disco lleno|basura|temporales|limpiar|liberar/.test(text)) return localToolCall('scan_temp_files');
  if (/inicio|arranca|prende lento|tarda en iniciar|programas al encender/.test(text)) return localToolCall('startup_review');
  if (/t[eé]cnico|persona|humano|remoto|rustdesk|escritorio remoto/.test(text)) return localToolCall('remote_support');
  if (/temperatura|calor|caliente|lenta|lento|colgada|congela|revisar|diagn[oó]stico|pc|rendimiento|recursos|ram|memoria|cpu|disco/.test(text)) return localToolCall('run_quick_diagnostic');
  return { message: { role: 'assistant', content: 'Contame qué notás o pedime revisar rendimiento, Internet, temperatura, seguridad, inicio u optimización.' }, entitlement: { plan: 'demo', remaining: null } };
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
