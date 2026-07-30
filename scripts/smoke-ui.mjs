import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.NEXO_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts/ui', { recursive: true });

async function waitForText(page, text, timeout = 25_000) {
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

async function assertCompactDialog(page, label) {
  const dialog = page.locator('.nx-dialog:visible').first();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${label}: dialog is not visible.`);
  if (box.width >= viewport.width - 28 || box.height >= viewport.height - 34) {
    throw new Error(`${label}: dialog covers almost the full app: ${JSON.stringify({ box, viewport })}`);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 460, height: 680 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Código de activación').fill('DEMO-PAIR');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await waitForText(page, '¿Cómo querés usar NEXO?');
  await assertCompactDialog(page, 'activation mode');
  await page.getByRole('button', { name: /Proteger esta PC/ }).click();
  await waitForText(page, 'NEXO está listo', 20_000);
  await waitForText(page, 'Hola. Soy NEXO');
  await assertNoBodyOverflow(page, 'assistant home');

  await page.getByRole('button', { name: 'Revisá mi PC' }).click();
  await waitForText(page, 'Memoria:');
  await waitForText(page, 'Disco:');
  await page.screenshot({ path: 'artifacts/ui/support-chat-evidence.png' });

  await page.getByRole('button', { name: 'Herramientas' }).click();
  await waitForText(page, 'Revisar y resolver');
  await page.getByRole('button', { name: /Optimizar/ }).click();
  await waitForText(page, 'Todavía no hay datos');
  await waitForText(page, 'Analizar basura');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-empty.png' });

  await page.getByRole('button', { name: 'Analizar basura' }).click();
  await waitForText(page, 'Calculando qué se puede limpiar');
  await waitForText(page, '742.0 MB disponibles', 30_000);
  await waitForText(page, 'Navegadores protegidos');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-ready.png' });

  await page.getByRole('button', { name: 'Optimizar ahora' }).click();
  await waitForText(page, 'Se borrarán solo temporales');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-confirm.png' });
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await waitForText(page, 'Limpiando basura segura');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-flight.png' });
  await waitForText(page, '721.0 MB liberados', 30_000);
  await waitForText(page, 'sesiones, cookies, perfiles y contraseñas de navegadores no se tocaron');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-done.png' });

  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: /Seguridad/ }).click();
  await waitForText(page, 'Todavía no hay datos');
  await page.getByRole('button', { name: 'Analizar ahora' }).click();
  await waitForText(page, 'Protección activa');
  await waitForText(page, 'Tiempo real');
  await page.screenshot({ path: 'artifacts/ui/support-security-evidence.png' });

  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: /Temperatura/ }).click();
  await page.getByRole('button', { name: /Analizar ahora|Actualizar análisis/ }).click();
  await waitForText(page, '48 °C máximo');
  await waitForText(page, 'CPU');
  await page.screenshot({ path: 'artifacts/ui/support-temperature-evidence.png' });

  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: /Soporte remoto/ }).click();
  await waitForText(page, 'RustDesk no está instalado');
  await page.screenshot({ path: 'artifacts/ui/support-remote-detection.png' });

  await page.setViewportSize({ width: 560, height: 760 });
  await assertNoBodyOverflow(page, 'resized support window');
  await page.screenshot({ path: 'artifacts/ui/support-resized.png' });

  if (pageErrors.length) throw new Error(`Errores de página: ${pageErrors.join(' | ')}`);

  const admin = await context.newPage();
  await admin.setViewportSize({ width: 1365, height: 768 });
  await admin.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await waitForText(admin, 'Administración');
  await admin.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible' });
  await admin.screenshot({ path: 'artifacts/ui/admin-login.png' });
  await assertNoBodyOverflow(admin, 'admin login');

  console.log('NEXO UI smoke passed: evidence-first chat, non-destructive tool inspection, inline safe optimization, rocket feedback, structured security and temperature results, remote client detection and responsive resizing.');
  await context.close();
} finally {
  await browser.close();
}
