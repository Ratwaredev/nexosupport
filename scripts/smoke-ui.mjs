import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.NEXO_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts/ui', { recursive: true });

async function waitText(page, text, timeout = 30_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

async function assertNoBodyOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyHeight: document.body.scrollHeight,
    viewportHeight: document.documentElement.clientHeight
  }));
  if (dimensions.bodyWidth > dimensions.viewportWidth || dimensions.bodyHeight > dimensions.viewportHeight) {
    throw new Error(`${label} body overflow: ${JSON.stringify(dimensions)}`);
  }
}

async function installSmokeBackend(context) {
  const now = new Date().toISOString();
  const diagnostics = [];
  const tickets = [];
  const device = {
    id: 'dev-smoke', org_name: 'NEXO', support_user_id: 'usr-smoke', display_name: 'PC de prueba',
    computer_name: 'NEXO-SMOKE', user_name: 'smoke', os: 'Windows 11 Pro', platform: 'windows',
    pairing_code: 'DEMO-PAIR', device_token: '0123456789abcdef0123456789abcdef0123456789abcdef', status: 'idle',
    last_seen_at: now, created_at: now, updated_at: now
  };
  const consent = {
    device_id: device.id, assistant_enabled: false, share_diagnostics: false, automatic_checks: false,
    hardware_sensors: true, elevated_sensors: false, updated_at: now
  };
  const entitlement = {
    device_id: device.id, status: 'active', plan: 'pro', model: null, monthly_message_limit: 1000,
    messages_used: 0, period_start: now, created_at: now, updated_at: now
  };

  await context.route('**/functions/v1/nexo-assistant', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    const messages = body.messages || [];
    const last = messages[messages.length - 1];
    const toolNames = messages.filter((item) => item.role === 'tool').map((item) => item.name);
    let message;
    if (last?.role === 'user') {
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'call-diagnostic-1', type: 'function', function: { name: 'run_quick_diagnostic', arguments: '{}' } }] };
    } else if (!toolNames.includes('disk_health')) {
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'call-disk-health', type: 'function', function: { name: 'disk_health', arguments: '{}' } }] };
    } else if (!toolNames.includes('scan_temp_files')) {
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'call-scan', type: 'function', function: { name: 'scan_temp_files', arguments: '{}' } }] };
    } else if (!toolNames.includes('clean_temp_files')) {
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'call-clean', type: 'function', function: { name: 'clean_temp_files', arguments: '{}' } }] };
    } else if (toolNames.filter((name) => name === 'run_quick_diagnostic').length < 2) {
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'call-diagnostic-2', type: 'function', function: { name: 'run_quick_diagnostic', arguments: '{}' } }] };
    } else {
      message = { role: 'assistant', content: 'Liberé espacio y verifiqué el equipo.' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message, entitlement: { plan: 'pro', remaining: 998 } }) });
  });

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' } });
      return;
    }
    const pathname = new URL(request.url()).pathname;
    let payload = [];
    if (pathname.endsWith('/rpc/register_device')) {
      payload = { session: { device_id: device.id, device_token: device.device_token, display_name: device.display_name, org_name: device.org_name }, device };
    } else if (pathname.endsWith('/rpc/get_client_dashboard')) {
      payload = { device, consent, entitlement, tickets, diagnostics, latest_release: null, latest_session: null };
    } else if (pathname.endsWith('/rpc/save_diagnostic')) {
      const requestBody = request.postDataJSON();
      const record = { id: `diag-${diagnostics.length + 1}`, device_id: device.id, generated_at: new Date().toISOString(), payload: requestBody.p_diagnostic || {} };
      diagnostics.unshift(record);
      payload = record;
    } else if (pathname.endsWith('/rpc/set_device_consents')) {
      const requestBody = request.postDataJSON();
      consent.assistant_enabled = Boolean(requestBody.p_assistant_enabled);
      consent.share_diagnostics = Boolean(requestBody.p_share_diagnostics);
      consent.automatic_checks = Boolean(requestBody.p_automatic_checks);
      consent.hardware_sensors = Boolean(requestBody.p_hardware_sensors);
      consent.elevated_sensors = Boolean(requestBody.p_elevated_sensors);
      payload = consent;
    } else if (pathname.endsWith('/rpc/create_ticket')) {
      const ticket = { id: 'NX-SMOKE', device_id: device.id, client_name: 'PC de prueba', issue: 'Soporte remoto · RustDesk 123 456 789', status: 'nuevo', priority: 'normal', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      tickets.unshift(ticket);
      payload = ticket;
    } else if (pathname.endsWith('/rpc/create_remote_session')) {
      payload = { id: 'ses-smoke', ticket_id: 'NX-SMOKE', device_id: device.id, code: 'ABC123', expires_in_minutes: 20, instructions: 'Aceptar conexión.', created_at: new Date().toISOString() };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' }, body: JSON.stringify(payload) });
  });

  return { diagnostics };
}

try {
  const context = await browser.newContext({ viewport: { width: 460, height: 680 }, deviceScaleFactor: 1 });
  const state = await installSmokeBackend(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Código de soporte').fill('DEMO-PAIR');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await waitText(page, 'Elegí cómo usar NEXO');
  await page.screenshot({ path: 'artifacts/ui/support-consent.png' });
  await page.getByRole('button', { name: /Revisión guiada/ }).click();
  await waitText(page, '¿Qué pasa con la PC?');
  await assertNoBodyOverflow(page, 'assistant');

  await page.getByRole('button', { name: 'Disco', exact: true }).click();
  await waitText(page, 'NEXO solicita');
  await waitText(page, 'Limpiar temporales');
  await page.screenshot({ path: 'artifacts/ui/support-agent-approval.png' });
  await page.getByRole('button', { name: 'Autorizar', exact: true }).click();
  await page.locator('.nv-agent-flight').waitFor({ state: 'visible' });
  if (await page.locator('.nv-agent-flight svg').count() !== 1) throw new Error('Agent optimization must render one rocket.');
  await page.screenshot({ path: 'artifacts/ui/support-agent-progress.png' });
  await waitText(page, 'Liberé espacio y verifiqué el equipo.');
  await waitText(page, 'Reporte enviado');
  const report = state.diagnostics.find((item) => item.payload?.kind === 'nexo-support-run');
  if (!report) throw new Error('Agent report was not saved.');
  if (!report.payload.actions.some((action) => action.tool === 'disk_health')) throw new Error('Disk health evidence was not recorded.');
  await page.screenshot({ path: 'artifacts/ui/support-agent-done.png' });

  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  for (const label of ['Estado general', 'Temperatura', 'Internet', 'Seguridad', 'Inicio', 'Optimizar', 'Soporte remoto']) {
    await page.getByRole('button', { name: new RegExp(label) }).waitFor({ state: 'attached' });
  }
  await page.getByRole('button', { name: /Optimizar/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ui/support-tools-minimal.png' });
  await assertNoBodyOverflow(page, 'tools');

  await page.getByRole('button', { name: /Optimizar/ }).click();
  await page.getByRole('button', { name: 'Analizar', exact: true }).click();
  await waitText(page, '742.0 MB disponibles');
  await page.getByRole('button', { name: 'Optimizar', exact: true }).click();
  await page.locator('.nv-confirm').getByRole('button', { name: 'Optimizar', exact: true }).click();
  await page.locator('.nv-flight').waitFor({ state: 'visible' });
  if (await page.locator('.nv-rocket').count() !== 1) throw new Error('Manual optimization must render exactly one rocket.');
  await waitText(page, '721.0 MB liberados');

  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: /Soporte remoto/ }).click();
  await waitText(page, '123 456 789');
  await waitText(page, 'Pedir soporte');
  await page.screenshot({ path: 'artifacts/ui/support-remote-ready.png' });

  await page.setViewportSize({ width: 560, height: 760 });
  await assertNoBodyOverflow(page, 'resized');
  await page.screenshot({ path: 'artifacts/ui/support-resized.png' });
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);

  const admin = await context.newPage();
  await admin.setViewportSize({ width: 1365, height: 768 });
  await admin.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await waitText(admin, 'Administración');
  await admin.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible' });
  await admin.screenshot({ path: 'artifacts/ui/admin-login.png' });
  await assertNoBodyOverflow(admin, 'admin');

  console.log('NEXO UI smoke passed: explicit consent, disk health, OpenRouter tool loop, visible approval, one-rocket optimization, report persistence and remote support.');
  await context.close();
} finally {
  await browser.close();
}
