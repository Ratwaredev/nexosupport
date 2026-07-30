import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.NEXO_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts/ui', { recursive: true });

async function waitForText(page, text, timeout = 20_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

async function waitForIdle(page, timeout = 30_000) {
  await page.locator('.nc-progress').waitFor({ state: 'hidden', timeout });
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

async function assertDesktopDialog(page, label) {
  const dialog = page.locator('.nc-sheet:visible, .nc-confirm:visible').first();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${label}: dialog is not visible.`);
  if (box.width >= viewport.width - 24 || box.height >= viewport.height - 24) {
    throw new Error(`${label}: dialog covers almost the full app: ${JSON.stringify({ box, viewport })}`);
  }
  const horizontalMargin = Math.min(box.x, viewport.width - box.x - box.width);
  const verticalMargin = Math.min(box.y, viewport.height - box.y - box.height);
  if (horizontalMargin < 18 || verticalMargin < 18) {
    throw new Error(`${label}: dialog is not centered with safe margins: ${JSON.stringify({ box, viewport })}`);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 500, height: 620 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Código de activación').fill('DEMO-PAIR');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await waitForText(page, '¿Cómo querés usar NEXO?');
  await assertDesktopDialog(page, 'activation mode');
  await page.getByRole('button', { name: /Proteger esta PC/ }).click();
  await waitForText(page, 'Revisión pendiente', 20_000);
  await assertNoBodyOverflow(page, 'support home before review');

  await page.getByRole('button', { name: /Revisar ahora/ }).click();
  await waitForText(page, 'Revisión terminada', 25_000);
  await waitForText(page, 'Tu PC está en orden', 20_000);
  await page.screenshot({ path: 'artifacts/ui/support-home.png' });
  await assertNoBodyOverflow(page, 'support home after review');

  await page.locator('.nc-actions').getByRole('button', { name: /Revisar Internet/ }).click();
  await waitForText(page, 'La conexión responde correctamente', 20_000);

  await page.locator('.nc-actions').getByRole('button', { name: /Optimizar equipo/ }).click();
  await waitForText(page, 'Mantenimiento del equipo');
  await assertDesktopDialog(page, 'tools');
  await page.getByRole('button', { name: /Revisar inicio/ }).click();
  await waitForIdle(page);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await waitForText(page, 'Acción de prueba completada', 20_000);

  await page.locator('.nc-readings').getByRole('button', { name: /Temperatura/ }).click();
  await waitForText(page, 'Temperatura del equipo');
  await assertDesktopDialog(page, 'temperature');
  await page.getByRole('button', { name: /Volver a buscar sensores/ }).click();
  await waitForIdle(page, 60_000);
  await waitForText(page, 'Vista previa', 20_000);
  await page.screenshot({ path: 'artifacts/ui/support-temperature.png' });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await waitForText(page, 'Temperatura actualizada', 20_000);

  await page.locator('.nc-actions').getByRole('button', { name: /Hablar con un técnico/ }).click();
  await waitForText(page, 'Soporte remoto');
  await waitForText(page, 'RustDesk no está instalado');
  await assertDesktopDialog(page, 'remote support');
  await page.screenshot({ path: 'artifacts/ui/support-remote.png' });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.setViewportSize({ width: 640, height: 760 });
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

  console.log('NEXO UI smoke passed: normal desktop proportions, resizable layout, centered dialogs, clear feedback, temperature panel, RustDesk flow and admin entry.');
  await context.close();
} finally {
  await browser.close();
}
