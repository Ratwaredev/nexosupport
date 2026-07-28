import { chromium } from 'playwright';

const baseUrl = process.env.NEXO_PREVIEW_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });

async function waitForText(page, text, timeout = 20_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Código de activación').fill('DEMO-PAIR');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await waitForText(page, '¿Qué querés hacer?');

  await page.getByRole('button', { name: /Proteger esta PC/ }).click();
  await waitForText(page, 'PC vinculada', 25_000);
  await waitForText(page, 'Estado del equipo', 25_000);

  const quickActions = page.locator('.nv2-quick-actions');
  await quickActions.getByRole('button', { name: 'Revisar' }).click();
  await waitForText(page, 'Revisión terminada', 25_000);

  await quickActions.getByRole('button', { name: 'Internet' }).click();
  await waitForText(page, 'La conexión responde correctamente', 20_000);

  await quickActions.getByRole('button', { name: 'Temperatura' }).click();
  await waitForText(page, 'Temperatura revisada', 20_000);

  await quickActions.getByRole('button', { name: 'Técnico' }).click();
  await waitForText(page, 'Soporte preparado', 20_000);

  if (pageErrors.length) {
    throw new Error(`Errores de página: ${pageErrors.join(' | ')}`);
  }

  const admin = await context.newPage();
  await admin.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await waitForText(admin, 'Administración');
  await admin.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible' });

  console.log('NEXO UI smoke passed: activation, protection, review, Internet, temperature, support and admin entry.');
  await context.close();
} finally {
  await browser.close();
}
