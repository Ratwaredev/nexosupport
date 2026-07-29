import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.NEXO_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts/ui', { recursive: true });

async function waitForText(page, text, timeout = 20_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyHeight: document.body.scrollHeight,
    viewportHeight: document.documentElement.clientHeight
  }));
  if (dimensions.bodyWidth > dimensions.viewportWidth || dimensions.bodyHeight > dimensions.viewportHeight) {
    throw new Error(`${label} overflow: ${JSON.stringify(dimensions)}`);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 420, height: 430 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Código de activación').fill('DEMO-PAIR');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await waitForText(page, '¿Cómo querés usar NEXO?');
  await page.getByRole('button', { name: /Proteger esta PC/ }).click();
  await waitForText(page, 'Revisión pendiente', 20_000);
  await assertNoOverflow(page, 'support home before review');

  await page.getByRole('button', { name: /^Revisar$/ }).click();
  await waitForText(page, 'Revisión lista', 25_000);
  await waitForText(page, 'Tu PC está en orden', 20_000);
  await page.screenshot({ path: 'artifacts/ui/support-home.png' });
  await assertNoOverflow(page, 'support home after review');

  await page.locator('.nc-actions').getByRole('button', { name: /Internet/ }).click();
  await waitForText(page, 'La conexión responde correctamente', 20_000);

  await page.locator('.nc-actions').getByRole('button', { name: /Optimizar/ }).click();
  await waitForText(page, '¿Qué querés mejorar?');
  await page.getByRole('button', { name: /Revisar inicio/ }).click();
  await waitForText(page, 'Acción de prueba completada', 20_000);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.locator('.nc-readings').getByRole('button', { name: /Temp\./ }).click();
  await waitForText(page, 'Temperatura del equipo');
  await page.getByRole('button', { name: /Volver a leer/ }).click();
  await waitForText(page, 'Temperatura actualizada', 20_000);
  await page.screenshot({ path: 'artifacts/ui/support-temperature.png' });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.locator('.nc-actions').getByRole('button', { name: /Técnico/ }).click();
  await waitForText(page, 'Soporte remoto');
  await waitForText(page, 'RustDesk no está instalado');
  await page.screenshot({ path: 'artifacts/ui/support-remote.png' });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  if (pageErrors.length) throw new Error(`Errores de página: ${pageErrors.join(' | ')}`);

  const admin = await context.newPage();
  await admin.setViewportSize({ width: 1365, height: 768 });
  await admin.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await waitForText(admin, 'Administración');
  await admin.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible' });
  await admin.screenshot({ path: 'artifacts/ui/admin-login.png' });
  await assertNoOverflow(admin, 'admin login');

  console.log('NEXO UI smoke passed: compact layout, explicit review, trusted temperature, tools, RustDesk flow, admin entry and no viewport overflow.');
  await context.close();
} finally {
  await browser.close();
}
