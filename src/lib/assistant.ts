import type { AgentActionResult, AgentStatus } from './agent';
import type { DiagnosticReport } from './diagnostics';
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
export type ToolDefinition = {
  id: AssistantToolId;
  label: string;
  shortLabel: string;
  description: string;
  mode: ToolMode;
  progressLabel: string;
};

export const TOOL_CATALOG: Record<AssistantToolId, ToolDefinition> = {
  run_quick_diagnostic: { id: 'run_quick_diagnostic', label: 'Revisar esta PC', shortLabel: 'Revisión general', description: 'Lee RAM, disco, reinicio pendiente, seguridad e inicio. No modifica nada.', mode: 'read', progressLabel: 'Revisando PC' },
  network_check: { id: 'network_check', label: 'Revisar Internet', shortLabel: 'Red', description: 'Comprueba adaptador, DNS, gateway y salida a Internet. No cambia la red.', mode: 'read', progressLabel: 'Revisando Internet' },
  scan_temp_files: { id: 'scan_temp_files', label: 'Analizar temporales', shortLabel: 'Temporales', description: 'Calcula el espacio recuperable en ubicaciones temporales permitidas. No borra nada.', mode: 'read', progressLabel: 'Analizando espacio' },
  startup_review: { id: 'startup_review', label: 'Revisar el inicio', shortLabel: 'Inicio', description: 'Lista programas que arrancan con Windows. No desactiva ninguno.', mode: 'read', progressLabel: 'Revisando inicio' },
  defender_status: { id: 'defender_status', label: 'Revisar seguridad', shortLabel: 'Seguridad', description: 'Lee Microsoft Defender y la protección en tiempo real.', mode: 'read', progressLabel: 'Revisando seguridad' },
  clean_temp_files: { id: 'clean_temp_files', label: 'Limpiar temporales', shortLabel: 'Limpiar temporales', description: 'Borra temporales antiguos de ubicaciones permitidas. No toca navegadores ni archivos personales.', mode: 'confirm', progressLabel: 'Optimizando' },
  repair_network: { id: 'repair_network', label: 'Reparar DNS', shortLabel: 'Reparar DNS', description: 'Limpia la caché DNS. No cambia el router ni la clave Wi‑Fi.', mode: 'confirm', progressLabel: 'Reparando red' },
  defender_quick_scan: { id: 'defender_quick_scan', label: 'Analizar con Defender', shortLabel: 'Defender', description: 'Inicia un análisis rápido oficial de Microsoft Defender.', mode: 'confirm', progressLabel: 'Iniciando Defender' },
  open_windows_update: { id: 'open_windows_update', label: 'Abrir Windows Update', shortLabel: 'Windows Update', description: 'Abre Windows Update. La persona controla la instalación.', mode: 'confirm', progressLabel: 'Abriendo Windows Update' },
  remote_support: { id: 'remote_support', label: 'Pedir soporte remoto', shortLabel: 'Soporte remoto', description: 'Crea una solicitud, abre RustDesk y mantiene la aceptación visible.', mode: 'support', progressLabel: 'Preparando soporte' }
};

export type ProviderToolCall = {
  id: string;
  type: 'function';
  function: { name: AssistantToolId; arguments: string };
};

export type ProviderMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: AssistantToolId;
};

export type AssistantRequest = {
  deviceToken: string;
  messages: ProviderMessage[];
  diagnostic?: DiagnosticReport | null;
  hardware?: SensorSummary | null;
  agentStatus?: AgentStatus | null;
  runContext?: Record<string, unknown> | null;
  appVersion: string;
};

export type AssistantResponse = {
  message: ProviderMessage;
  entitlement?: { plan: string; remaining: number | null };
};

const explicitBase = (import.meta.env.VITE_NEXO_API_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
const supabaseBase = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/$/, '') || '';

function endpoint() {
  if (explicitBase) {
    if (/\/(api\/assistant|functions\/v1\/nexo-assistant)$/.test(explicitBase)) return explicitBase;
    return `${explicitBase}/api/assistant`;
  }
  return supabaseBase ? `${supabaseBase}/functions/v1/nexo-assistant` : '';
}

export const assistantEndpoint = endpoint();

const lastUserText = (messages: ProviderMessage[]) => [...messages].reverse().find((message) => message.role === 'user')?.content?.toLowerCase() ?? '';
const lastTool = (messages: ProviderMessage[]) => messages[messages.length - 1]?.role === 'tool' ? messages[messages.length - 1] : undefined;

function localToolCall(name: AssistantToolId): AssistantResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: `local-${Date.now()}`, type: 'function', function: { name, arguments: '{}' } }]
    },
    entitlement: { plan: 'local', remaining: null }
  };
}

function localFallback(messages: ProviderMessage[]): AssistantResponse {
  const tool = lastTool(messages);
  if (tool) {
    let parsed: { ok?: boolean; message?: string } | null = null;
    try { parsed = JSON.parse(tool.content ?? '{}') as { ok?: boolean; message?: string }; } catch { parsed = null; }
    return {
      message: {
        role: 'assistant',
        content: parsed?.ok === false ? 'No se completó.' : (parsed?.message || 'Listo.')
      },
      entitlement: { plan: 'local', remaining: null }
    };
  }
  const text = lastUserText(messages);
  if (/remoto|rustdesk|soporte|t[eé]cnico/.test(text)) return localToolCall('remote_support');
  if (/internet|wifi|wi-fi|red|dns|gateway/.test(text)) return localToolCall('network_check');
  if (/virus|seguridad|defender|malware|antivirus/.test(text)) return localToolCall('defender_status');
  if (/optimizar|espacio|disco lleno|basura|temporales|limpiar|liberar/.test(text)) return localToolCall('scan_temp_files');
  if (/inicio|arranca|prende lento|tarda en iniciar/.test(text)) return localToolCall('startup_review');
  return localToolCall('run_quick_diagnostic');
}

export async function requestAssistant(input: AssistantRequest): Promise<AssistantResponse> {
  if (!input.deviceToken) throw new Error('Esta PC no está conectada.');
  if (!assistantEndpoint) {
    if (import.meta.env.DEV) return localFallback(input.messages);
    throw new Error('El agente no está disponible.');
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(assistantEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.deviceToken}`
      },
      body: JSON.stringify({
        messages: input.messages.slice(-30),
        diagnostic: input.diagnostic ?? null,
        hardware: input.hardware ?? null,
        agentStatus: input.agentStatus ?? null,
        runContext: input.runContext ?? null,
        appVersion: input.appVersion
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || 'NEXO no pudo responder.');
    }
    const payload = await response.json() as AssistantResponse;
    if (!payload?.message || !['assistant', 'tool', 'user'].includes(payload.message.role)) throw new Error('Respuesta inválida del agente.');
    if (payload.message.tool_calls) {
      payload.message.tool_calls = payload.message.tool_calls
        .filter((call) => Boolean(TOOL_CATALOG[call.function?.name]))
        .slice(0, 1);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('El agente tardó demasiado.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function normalizeToolResult(result: AgentActionResult | DiagnosticReport | HardwareSnapshot | Record<string, unknown>) {
  return JSON.stringify(result);
}
