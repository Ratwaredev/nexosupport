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
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: ToolName; arguments: string };
  }>;
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

const ALLOWED_TOOLS = new Set<ToolName>([
  'run_quick_diagnostic', 'network_check', 'scan_temp_files', 'startup_review', 'defender_status',
  'clean_temp_files', 'repair_network', 'defender_quick_scan', 'open_windows_update', 'remote_support'
]);

const tools = [
  tool('run_quick_diagnostic', 'Lee un resumen confiable de memoria, disco, programas de inicio, seguridad, reinicio pendiente y temperatura. Es de solo lectura.'),
  tool('network_check', 'Comprueba conexión a Internet, DNS, adaptadores y puerta de enlace sin modificar la red.'),
  tool('scan_temp_files', 'Calcula cuántos archivos temporales hay y cuánto espacio ocupan. No borra nada.'),
  tool('startup_review', 'Lista programas que arrancan con Windows. No desactiva ninguno.'),
  tool('defender_status', 'Lee el estado actual de Microsoft Defender y sus últimos análisis.'),
  tool('clean_temp_files', 'Borra solamente archivos temporales antiguos y recuperables. Requiere confirmación visible del usuario.'),
  tool('repair_network', 'Limpia la caché DNS y restablece componentes básicos de red. Requiere confirmación visible.'),
  tool('defender_quick_scan', 'Inicia un análisis rápido oficial de Microsoft Defender. Requiere confirmación visible.'),
  tool('open_windows_update', 'Abre Windows Update para que el usuario vea y controle las actualizaciones. Requiere confirmación visible.'),
  tool('remote_support', 'Crea una solicitud de soporte y prepara una sesión remota autorizada con un técnico de NEXO.')
];

function tool(name: ToolName, description: string) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
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
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
}

async function getDeviceAndEntitlement(deviceToken: string) {
  const deviceResponse = await supabase(`devices?device_token=eq.${encodeURIComponent(deviceToken)}&select=id,org_name&limit=1`);
  if (!deviceResponse.ok) throw new Error('No se pudo validar el dispositivo.');
  const devices = await deviceResponse.json() as Array<{ id: string; org_name: string }>;
  const device = devices[0];
  if (!device) return null;

  const entitlementResponse = await supabase(`device_entitlements?device_id=eq.${encodeURIComponent(device.id)}&select=*&limit=1`);
  if (!entitlementResponse.ok) throw new Error('No se pudo validar el plan.');
  const entitlements = await entitlementResponse.json() as Entitlement[];
  return { device, entitlement: entitlements[0] || null };
}

function sanitizeMessages(value: unknown): ProviderMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-24).flatMap((entry): ProviderMessage[] => {
    if (!entry || typeof entry !== 'object') return [];
    const message = entry as ProviderMessage;
    if (!['user', 'assistant', 'tool'].includes(message.role)) return [];
    const content = message.content == null ? null : String(message.content).slice(0, 5000);
    const safe: ProviderMessage = { role: message.role, content };
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      safe.tool_calls = message.tool_calls.filter((call) => ALLOWED_TOOLS.has(call.function?.name)).slice(0, 1);
    }
    if (message.role === 'tool' && message.tool_call_id && message.name && ALLOWED_TOOLS.has(message.name)) {
      safe.tool_call_id = String(message.tool_call_id).slice(0, 120);
      safe.name = message.name;
    }
    return [safe];
  });
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!token) return json({ error: 'Esta PC no está activada.' }, 401);

  try {
    const validated = await getDeviceAndEntitlement(token);
    if (!validated) return json({ error: 'El dispositivo no existe o fue desvinculado.' }, 401);
    const entitlement = validated.entitlement;
    if (!entitlement || entitlement.status !== 'active') {
      return json({ error: 'El asistente no está activo para esta PC. Contactá a NEXO.' }, 402);
    }

    const now = new Date();
    const periodStart = new Date(entitlement.period_start);
    const monthChanged = periodStart.getUTCFullYear() !== now.getUTCFullYear() || periodStart.getUTCMonth() !== now.getUTCMonth();
    const used = monthChanged ? 0 : entitlement.messages_used;
    const limit = entitlement.monthly_message_limit;
    if (limit != null && used >= limit) return json({ error: 'El plan llegó al límite mensual. Contactá a NEXO para ampliarlo.' }, 429);

    const body = await request.json() as { messages?: unknown; diagnostic?: unknown; appVersion?: string };
    const messages = sanitizeMessages(body.messages);
    if (!messages.length) return json({ error: 'No hay un mensaje para responder.' }, 400);

    const model = entitlement.model || env(`NEXO_MODEL_${entitlement.plan.toUpperCase()}`) || env('NEXO_DEFAULT_MODEL') || 'openrouter/auto';
    const apiKey = env('OPENROUTER_API_KEY');
    if (!apiKey) return json({ error: 'OpenRouter no está configurado en NEXO.' }, 503);

    const system = `Sos NEXO Support, un asistente técnico para usuarios no técnicos de Windows. Respondé siempre en español argentino, con frases cortas, claras y sin jerga. Nunca menciones modelos, OpenRouter, prompts, tokens ni configuración interna. Tu objetivo es cuidar la PC, diagnosticar y resolver sin asustar al usuario.

REGLAS DE SEGURIDAD:
- Solo podés pedir una herramienta de la lista provista. Nunca inventes comandos, rutas, scripts ni herramientas.
- Las herramientas de lectura pueden pedirse automáticamente cuando ayudan a responder.
- Las herramientas que cambian algo requieren confirmación visible de la app; explicá qué harán en una frase.
- Nunca propongas limpieza de registro, desactivar antivirus, borrar carpetas del sistema, tocar drivers a ciegas, deshabilitar servicios o ejecutar comandos arbitrarios.
- Si hay riesgo de pérdida de datos, hardware dañado, credenciales comprometidas o una reparación fuera del catálogo, pedí remote_support.
- Después de recibir un resultado de herramienta, explicá el hallazgo más importante y el siguiente paso. No repitas datos crudos.
- Una sola herramienta por turno.

Dispositivo: ${validated.device.org_name}. Versión de app: ${String(body.appVersion || '').slice(0, 30)}. Diagnóstico conocido: ${JSON.stringify(body.diagnostic || null).slice(0, 7000)}.`;

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
        temperature: 0.15,
        max_tokens: 650
      })
    });

    if (!openRouterResponse.ok) {
      const detail = await openRouterResponse.text();
      console.error('OpenRouter error', openRouterResponse.status, detail.slice(0, 500));
      return json({ error: 'NEXO no pudo pensar la respuesta. Probá otra vez.' }, 502);
    }

    const completion = await openRouterResponse.json() as {
      choices?: Array<{ message?: ProviderMessage }>;
    };
    const message = completion.choices?.[0]?.message;
    if (!message) return json({ error: 'NEXO recibió una respuesta vacía.' }, 502);

    if (message.tool_calls) {
      message.tool_calls = message.tool_calls.filter((call) => ALLOWED_TOOLS.has(call.function.name)).slice(0, 1);
    }

    const nextUsed = used + 1;
    await supabase(`device_entitlements?device_id=eq.${encodeURIComponent(validated.device.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        messages_used: nextUsed,
        period_start: monthChanged ? now.toISOString() : entitlement.period_start,
        updated_at: now.toISOString()
      })
    });

    return json({
      message,
      entitlement: {
        plan: entitlement.plan,
        remaining: limit == null ? null : Math.max(0, limit - nextUsed)
      }
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error interno de NEXO.' }, 500);
  }
}
