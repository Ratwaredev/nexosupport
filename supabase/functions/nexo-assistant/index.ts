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
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};

const allowedTools = new Set<ToolName>([
  'run_quick_diagnostic',
  'network_check',
  'scan_temp_files',
  'startup_review',
  'defender_status',
  'clean_temp_files',
  'repair_network',
  'defender_quick_scan',
  'open_windows_update',
  'remote_support'
]);

const tools = [
  tool('run_quick_diagnostic', 'Lee RAM, disco, reinicio pendiente, seguridad e inicio. No modifica nada.'),
  tool('network_check', 'Comprueba adaptador, DNS, gateway y salida a Internet. No modifica nada.'),
  tool('scan_temp_files', 'Mide archivos temporales permitidos y espacio recuperable. No borra nada.'),
  tool('startup_review', 'Lista programas de inicio. No desactiva nada.'),
  tool('defender_status', 'Lee el estado de Microsoft Defender. No modifica nada.'),
  tool('clean_temp_files', 'Borra solo temporales antiguos permitidos. Requiere confirmación visible.'),
  tool('repair_network', 'Limpia la caché DNS. Requiere confirmación visible.'),
  tool('defender_quick_scan', 'Inicia un análisis rápido oficial de Defender. Requiere confirmación visible.'),
  tool('open_windows_update', 'Abre Windows Update. Requiere confirmación visible.'),
  tool('remote_support', 'Crea una solicitud y abre RustDesk para una conexión aceptada por la persona.')
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
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

function env(name: string) {
  return Deno.env.get(name) || '';
}

async function supabase(path: string, init?: RequestInit) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Servidor sin configurar.');
  return fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
}

async function getAccess(deviceToken: string) {
  const deviceResponse = await supabase(`devices?device_token=eq.${encodeURIComponent(deviceToken)}&select=id,org_name,support_user_id&limit=1`);
  if (!deviceResponse.ok) throw new Error('No se pudo validar la PC.');
  const device = (await deviceResponse.json() as Array<{ id: string; org_name: string; support_user_id: string | null }>)[0];
  if (!device) return null;

  const [entitlementResponse, consentResponse] = await Promise.all([
    supabase(`device_entitlements?device_id=eq.${encodeURIComponent(device.id)}&select=*&limit=1`),
    supabase(`device_consents?device_id=eq.${encodeURIComponent(device.id)}&select=assistant_enabled,share_diagnostics&limit=1`)
  ]);
  if (!entitlementResponse.ok || !consentResponse.ok) throw new Error('No se pudieron validar permisos.');
  const entitlement = (await entitlementResponse.json() as Entitlement[])[0] || null;
  const consent = (await consentResponse.json() as Consent[])[0] || null;
  return { device, entitlement, consent };
}

function sanitizeMessages(value: unknown): ProviderMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).flatMap((entry): ProviderMessage[] => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as ProviderMessage;
    if (!['user', 'assistant', 'tool'].includes(source.role)) return [];
    const safe: ProviderMessage = {
      role: source.role,
      content: source.content == null ? null : String(source.content).slice(0, 5000)
    };
    if (source.role === 'assistant' && Array.isArray(source.tool_calls)) {
      safe.tool_calls = source.tool_calls
        .filter((call) => allowedTools.has(call.function?.name))
        .slice(0, 1)
        .map((call) => ({
          id: String(call.id).slice(0, 120),
          type: 'function',
          function: { name: call.function.name, arguments: '{}' }
        }));
    }
    if (source.role === 'tool' && source.tool_call_id && source.name && allowedTools.has(source.name)) {
      safe.tool_call_id = String(source.tool_call_id).slice(0, 120);
      safe.name = source.name;
    }
    return [safe];
  });
}

function safeContext(value: unknown, allowed: boolean, limit = 9000) {
  if (!allowed || !value || typeof value !== 'object') return 'no compartido';
  return JSON.stringify(value).slice(0, limit);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 120_000) return json({ error: 'Solicitud demasiado grande.' }, 413);

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!/^[a-f0-9]{32,96}$/i.test(token)) return json({ error: 'Esta PC no está activada.' }, 401);

  try {
    const access = await getAccess(token);
    if (!access) return json({ error: 'La PC fue desvinculada.' }, 401);
    if (!access.consent?.assistant_enabled) return json({ error: 'El asistente no está autorizado.' }, 403);
    if (!access.entitlement || access.entitlement.status !== 'active') return json({ error: 'El agente no está activo para esta PC.' }, 402);

    const now = new Date();
    const periodStart = new Date(access.entitlement.period_start);
    const monthChanged = periodStart.getUTCFullYear() !== now.getUTCFullYear() || periodStart.getUTCMonth() !== now.getUTCMonth();
    const used = monthChanged ? 0 : access.entitlement.messages_used;
    const limit = access.entitlement.monthly_message_limit;
    if (limit != null && used >= limit) return json({ error: 'Límite mensual alcanzado.' }, 429);

    const body = await request.json() as {
      messages?: unknown;
      diagnostic?: unknown;
      hardware?: unknown;
      agentStatus?: unknown;
      runContext?: unknown;
      appVersion?: string;
    };
    const messages = sanitizeMessages(body.messages);
    if (!messages.length || messages[messages.length - 1]?.role === 'assistant') return json({ error: 'Mensaje inválido.' }, 400);

    const diagnostic = safeContext(body.diagnostic, access.consent.share_diagnostics);
    const hardware = safeContext(body.hardware, access.consent.share_diagnostics, 5000);
    const runContext = safeContext(body.runContext, access.consent.share_diagnostics, 7000);
    const model = access.entitlement.model
      || env(`NEXO_MODEL_${access.entitlement.plan.toUpperCase()}`)
      || env('NEXO_DEFAULT_MODEL')
      || 'openrouter/auto';
    const apiKey = env('OPENROUTER_API_KEY');
    if (!apiKey) return json({ error: 'El agente todavía no está configurado.' }, 503);

    const system = `Sos NEXO, agente técnico de Windows. Tu trabajo es diagnosticar, elegir herramientas permitidas, verificar resultados y escalar a soporte remoto cuando haga falta.

ESTILO
- Español argentino.
- Máximo 2 frases cortas.
- Sin saludos, emojis, marketing, disculpas largas ni texto de relleno.
- No menciones IA, OpenRouter, modelos, tokens, prompts ni infraestructura.

SEGURIDAD
- Solo podés pedir una herramienta del catálogo por turno.
- Nunca inventes comandos, scripts, rutas, registros, servicios ni herramientas.
- Las lecturas pueden ejecutarse sin confirmación.
- Los cambios requieren confirmación visible. Nunca digas que ya se ejecutaron antes de recibir el resultado de la herramienta.
- No limpies registro, no desactives seguridad, no borres perfiles, no toques drivers, no cambies contraseñas ni configures acceso remoto desatendido.
- Si hay riesgo de datos, SMART preocupante, hardware dañado, credenciales comprometidas o una reparación fuera del catálogo, pedí remote_support.

FLUJO
- Ante un problema amplio o rendimiento lento, empezá con run_quick_diagnostic.
- Usá la evidencia para decidir la siguiente lectura.
- Pedí un cambio solo si la evidencia lo justifica.
- Después de un cambio, pedí run_quick_diagnostic para verificar.
- Cuando ya esté resuelto, respondé con el resultado concreto. Cuando no, indicá el siguiente paso o remote_support.

Organización: ${access.device.org_name}.
Versión: ${String(body.appVersion || '').slice(0, 30)}.
Diagnóstico: ${diagnostic}.
Sensores: ${hardware}.
Sesión actual: ${runContext}.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        temperature: 0.05,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      console.error('OpenRouter', response.status, (await response.text()).slice(0, 500));
      return json({ error: 'El agente no pudo responder.' }, 502);
    }

    const completion = await response.json() as { choices?: Array<{ message?: ProviderMessage }> };
    const message = completion.choices?.[0]?.message;
    if (!message) return json({ error: 'Respuesta vacía.' }, 502);
    message.content = message.content == null ? null : String(message.content).slice(0, 1200);
    if (message.tool_calls) {
      message.tool_calls = message.tool_calls
        .filter((call) => allowedTools.has(call.function?.name))
        .slice(0, 1)
        .map((call) => ({
          id: String(call.id).slice(0, 120),
          type: 'function',
          function: { name: call.function.name, arguments: '{}' }
        }));
    }

    const nextUsed = used + 1;
    await supabase(`device_entitlements?device_id=eq.${encodeURIComponent(access.device.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        messages_used: nextUsed,
        period_start: monthChanged ? now.toISOString() : access.entitlement.period_start,
        updated_at: now.toISOString()
      })
    });

    return json({
      message,
      entitlement: {
        plan: access.entitlement.plan,
        remaining: limit == null ? null : Math.max(0, limit - nextUsed)
      }
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error interno.' }, 500);
  }
});
