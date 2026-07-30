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

try {
  const context = await browser.newContext({ viewport: { width: 460, height: 680 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Código de soporte').fill('DEMO-PAIR');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await waitText(page, 'PC conectada');
  await waitText(page, 'Hola. ¿Qué revisamos?');
  await assertNoBodyOverflow(page, 'assistant');

  await page.getByRole('button', { name: 'Revisar PC', exact: true }).click();
  await waitText(page, 'Memoria:');
  await waitText(page, 'Disco:');
  await page.screenshot({ path: 'artifacts/ui/support-chat-evidence.png' });

  await page.getByRole('button', { name: 'Herramientas', exact: true }).click();
  for (const label of ['Estado general', 'Temperatura', 'Internet', 'Seguridad', 'Inicio', 'Optimizar', 'Soporte remoto']) {
    await page.getByRole('button', { name: new RegExp(label) }).waitFor({ state: 'attached' });
  }
  await page.getByRole('button', { name: /Optimizar/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ui/support-tools-minimal.png' });
  await assertNoBodyOverflow(page, 'tools');

  await page.getByRole('button', { name: /Optimizar/ }).click();
  await waitText(page, 'Sin datos');
  if (await page.locator('.nv-rocket').count()) throw new Error('Rocket rendered before optimization.');
  await page.getByRole('button', { name: 'Analizar', exact: true }).click();
  await waitText(page, 'Analizando');
  if (await page.locator('.nv-rocket').count()) throw new Error('Rocket rendered during scan.');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-scan.png' });
  await waitText(page, '742.0 MB disponibles');

  await page.getByRole('button', { name: 'Optimizar', exact: true }).click();
  await waitText(page, '¿Optimizar?');
  await page.locator('.nv-confirm').getByRole('button', { name: 'Optimizar', exact: true }).click();
  await page.locator('.nv-flight').waitFor({ state: 'visible' });
  if (await page.locator('.nv-rocket').count() !== 1) throw new Error('Optimization must render exactly one rocket.');
  await page.getByText(/%$/).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-flight.png' });
  await waitText(page, '721.0 MB liberados');
  await page.screenshot({ path: 'artifacts/ui/support-optimizer-done.png' });

  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: /Soporte remoto/ }).click();
  await waitText(page, '123 456 789');
  await waitText(page, 'Abrir soporte');
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

  console.log('NEXO UI smoke passed: minimal tools, real evidence, scan without rocket, one-rocket optimization, percent feedback and ready remote support.');
  await context.close();
} finally {
  await browser.close();
}
