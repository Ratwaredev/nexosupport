export const config = { runtime: 'edge' };

type ToolName =
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

type ProviderMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: ToolName; arguments: string } }>;
  tool_call_id?: string;
  name?: ToolName;
};

type Entitlement = {
  device_id: string;
  status: string;
  plan: string;
  model: string | null;
  monthly_message_limit: number | null;
  messages_used: number;
  period_start: string;
};

type Consent = {
  assistant_enabled: boolean;
  share_diagnostics: boolean;
  automatic_checks: boolean;
  hardware_sensors: boolean;
  elevated_sensors: boolean;
};

const ALLOWED_TOOLS = new Set<ToolName>([
  'run_quick_diagnostic', 'network_check', 'scan_temp_files', 'startup_review', 'defender_status',
  'clean_temp_files', 'repair_network', 'defender_quick_scan', 'open_windows_update', 'remote_support'
]);

const tools = [
  tool('run_quick_diagnostic', 'Lee un resumen de rendimiento, almacenamiento, seguridad y sensores que el usuario haya autorizado. No modifica nada.'),
  tool('network_check', 'Comprueba conexión a Internet, DNS, adaptadores y puerta de enlace sin modificar la red.'),
  tool('scan_temp_files', 'Calcula cuántos archivos temporales hay y cuánto espacio ocupan. No borra nada.'),
  tool('startup_review', 'Lista programas que arrancan con Windows. No desactiva ninguno.'),
  tool('defender_status', 'Lee el estado actual de Microsoft Defender y sus últimos análisis.'),
  tool('clean_temp_files', 'Borra solamente archivos temporales antiguos del usuario. Requiere confirmación visible.'),
  tool('repair_network', 'Limpia la caché DNS. Requiere confirmación visible.'),
  tool('defender_quick_scan', 'Inicia un análisis rápido oficial de Microsoft Defender. Requiere confirmación visible.'),
  tool('open_windows_update', 'Abre Windows Update para que el usuario vea y controle las actualizaciones.'),
  tool('remote_support', 'Crea una solicitud y prepara una sesión remota autorizada con un técnico de NEXO.')
];

function tool(name: ToolName, description: string) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties: {}, additionalProperties: false } } };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function env(name: string) {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name] || '';
}

async function supabase(path: string, init?: RequestInit) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !serviceKey) throw new Error('Supabase del servidor no está configurado.');
  return fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
}

async function getDeviceAccess(deviceToken: string) {
  const deviceResponse = await supabase(`devices?device_token=eq.${encodeURIComponent(deviceToken)}&select=id,org_name,support_user_id&limit=1`);
  if (!deviceResponse.ok) throw new Error('No se pudo validar el dispositivo.');
  const device = (await deviceResponse.json() as Array<{ id: string; org_name: string; support_user_id: string | null }>)[0];
  if (!device) return null;

  const [entitlementResponse, consentResponse] = await Promise.all([
    supabase(`device_entitlements?device_id=eq.${encodeURIComponent(device.id)}&select=*&limit=1`),
    supabase(`device_consents?device_id=eq.${encodeURIComponent(device.id)}&select=*&limit=1`)
  ]);
  if (!entitlementResponse.ok) throw new Error('No se pudo validar el plan.');
  if (!consentResponse.ok) throw new Error('No se pudieron validar los permisos.');
  const entitlement = (await entitlementResponse.json() as Entitlement[])[0] || null;
  const consent = (await consentResponse.json() as Consent[])[0] || null;
  return { device, entitlement, consent };
}

function sanitizeMessages(value: unknown): ProviderMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-24).flatMap((entry): ProviderMessage[] => {
    if (!entry || typeof entry !== 'object') return [];
    const message = entry as ProviderMessage;
    if (!['user', 'assistant', 'tool'].includes(message.role)) return [];
    const safe: ProviderMessage = { role: message.role, content: message.content == null ? null : String(message.content).slice(0, 5000) };
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) safe.tool_calls = message.tool_calls.filter(call => ALLOWED_TOOLS.has(call.function?.name)).slice(0, 1);
    if (message.role === 'tool' && message.tool_call_id && message.name && ALLOWED_TOOLS.has(message.name)) {
      safe.tool_call_id = String(message.tool_call_id).slice(0, 120);
      safe.name = message.name;
    }
    return [safe];
  });
}

function safeContext(value: unknown, allowed: boolean) {
  if (!allowed || !value || typeof value !== 'object') return null;
  return JSON.stringify(value).slice(0, 7000);
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!token) return json({ error: 'Esta PC no está activada.' }, 401);

  try {
    const access = await getDeviceAccess(token);
    if (!access) return json({ error: 'El dispositivo no existe o fue desvinculado.' }, 401);
    if (!access.consent?.assistant_enabled) return json({ error: 'Primero autorizá el uso del asistente desde Permisos.' }, 403);
    const entitlement = access.entitlement;
    if (!entitlement || entitlement.status !== 'active') return json({ error: 'El asistente no está activo para esta PC. Contactá a NEXO.' }, 402);

    const now = new Date();
    const periodStart = new Date(entitlement.period_start);
    const monthChanged = periodStart.getUTCFullYear() !== now.getUTCFullYear() || periodStart.getUTCMonth() !== now.getUTCMonth();
    const used = monthChanged ? 0 : entitlement.messages_used;
    const limit = entitlement.monthly_message_limit;
    if (limit != null && used >= limit) return json({ error: 'El plan llegó al límite mensual. Contactá a NEXO.' }, 429);

    const body = await request.json() as { messages?: unknown; diagnostic?: unknown; hardware?: unknown; appVersion?: string };
    const messages = sanitizeMessages(body.messages);
    if (!messages.length) return json({ error: 'No hay un mensaje para responder.' }, 400);

    const model = entitlement.model || env(`NEXO_MODEL_${entitlement.plan.toUpperCase()}`) || env('NEXO_DEFAULT_MODEL') || 'openrouter/auto';
    const apiKey = env('OPENROUTER_API_KEY');
    if (!apiKey) return json({ error: 'El asistente todavía no está configurado por NEXO.' }, 503);

    const diagnostic = safeContext(body.diagnostic, access.consent.share_diagnostics);
    const hardware = safeContext(body.hardware, access.consent.share_diagnostics);
    const system = `Sos el asistente técnico de NEXO Support para una persona que no necesita entender informática. Respondé en español argentino, con frases cortas, concretas y sin tono infantil. No uses emojis, entusiasmo artificial ni frases de marketing. Nunca menciones modelos, OpenRouter, prompts, tokens o infraestructura.

REGLAS:
- Solo podés solicitar herramientas del catálogo. Nunca inventes comandos, scripts, rutas o herramientas.
- Una herramienta de lectura puede solicitarse para verificar una hipótesis.
- Cualquier cambio requiere confirmación visible en la aplicación.
- Nunca propongas limpieza de registro, desactivar seguridad, borrar carpetas del sistema, tocar drivers a ciegas, deshabilitar servicios o ejecutar comandos arbitrarios.
- No afirmes que una temperatura ACPI es la temperatura exacta del CPU. Usá únicamente sensores identificados como CPU/GPU cuando estén presentes.
- Si hay riesgo de pérdida de datos, hardware posiblemente dañado, credenciales comprometidas o una reparación fuera del catálogo, pedí remote_support.
- Después de una herramienta, explicá solo el hallazgo importante y el siguiente paso.
- Una sola herramienta por turno.

Organización: ${access.device.org_name}. Versión: ${String(body.appVersion || '').slice(0, 30)}.
Diagnóstico compartido por el usuario: ${diagnostic ?? 'no autorizado'}.
Sensores compartidos por el usuario: ${hardware ?? 'no autorizado'}.`;

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env('NEXO_APP_URL') || 'https://nexo.local',
        'X-OpenRouter-Title': 'NEXO Support'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        temperature: 0.1,
        max_tokens: 520
      })
    });

    if (!openRouterResponse.ok) {
      const detail = await openRouterResponse.text();
      console.error('OpenRouter error', openRouterResponse.status, detail.slice(0, 500));
      return json({ error: 'NEXO no pudo responder. Probá otra vez.' }, 502);
    }

    const completion = await openRouterResponse.json() as { choices?: Array<{ message?: ProviderMessage }> };
    const message = completion.choices?.[0]?.message;
    if (!message) return json({ error: 'NEXO recibió una respuesta vacía.' }, 502);
    if (message.tool_calls) message.tool_calls = message.tool_calls.filter(call => ALLOWED_TOOLS.has(call.function.name)).slice(0, 1);

    const nextUsed = used + 1;
    await supabase(`device_entitlements?device_id=eq.${encodeURIComponent(access.device.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ messages_used: nextUsed, period_start: monthChanged ? now.toISOString() : entitlement.period_start, updated_at: now.toISOString() })
    });

    return json({ message, entitlement: { plan: entitlement.plan, remaining: limit == null ? null : Math.max(0, limit - nextUsed) } });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error interno de NEXO.' }, 500);
  }
}
