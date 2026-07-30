import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.NEXO_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts/ui', { recursive: true });

async function waitForText(page, text, timeout = 20_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

async function settle(page, delay = 650) {
  await page.waitForTimeout(delay);
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
  const dialog = page.locator('.nc-sheet:visible').first();
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
  await waitForText(page, 'Tu PC está en orden', 30_000);
  await settle(page);
  await page.screenshot({ path: 'artifacts/ui/support-chat.png' });

  await page.getByRole('button', { name: 'Herramientas' }).click();
  await waitForText(page, 'Estado general');
  await waitForText(page, 'Liberar espacio');
  await assertNoBodyOverflow(page, 'tools view');
  await settle(page, 250);
  await page.screenshot({ path: 'artifacts/ui/support-tools.png' });

  await page.getByRole('button', { name: /Liberar espacio/ }).click();
  await waitForText(page, 'requiere tu autorización');
  await settle(page);
  await page.screenshot({ path: 'artifacts/ui/support-confirm.png' });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await waitForText(page, 'No hice ningún cambio');

  await page.getByRole('button', { name: 'Herramientas' }).click();
  await page.getByRole('button', { name: /Temperatura/ }).first().click();
  await waitForText(page, 'temperatura más alta', 20_000);
  await settle(page);
  await page.screenshot({ path: 'artifacts/ui/support-temperature-chat.png' });

  await page.getByRole('button', { name: 'Herramientas' }).click();
  await page.getByRole('button', { name: /Pedir un técnico/ }).click();
  await waitForText(page, 'solicitud quedó creada', 20_000);
  await settle(page, 900);
  await page.screenshot({ path: 'artifacts/ui/support-remote-chat.png' });

  await page.getByRole('button', { name: 'Herramientas' }).click();
  await page.getByRole('button', { name: /Ver sensores/ }).click();
  await waitForText(page, 'Temperatura del equipo');
  await assertCompactDialog(page, 'temperature details');
  await settle(page, 250);
  await page.screenshot({ path: 'artifacts/ui/support-temperature-panel.png' });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.setViewportSize({ width: 560, height: 760 });
  await assertNoBodyOverflow(page, 'resized support window');
  await settle(page, 250);
  await page.screenshot({ path: 'artifacts/ui/support-resized.png' });

  if (pageErrors.length) throw new Error(`Errores de página: ${pageErrors.join(' | ')}`);

  const admin = await context.newPage();
  await admin.setViewportSize({ width: 1365, height: 768 });
  await admin.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await waitForText(admin, 'Administración');
  await admin.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible' });
  await admin.screenshot({ path: 'artifacts/ui/admin-login.png' });
  await assertNoBodyOverflow(admin, 'admin login');

  console.log('NEXO UI smoke passed: chatbot-first assistant, separate minimal tools view, inline confirmations, compact dialogs, responsive resizing and admin entry.');
  await context.close();
} finally {
  await browser.close();
}
