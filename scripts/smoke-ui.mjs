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
  await waitForText(page, '¿Cómo querés usar NEXO?');
  await page.getByRole('button', { name: /Proteger esta PC/ }).click();
  await waitForText(page, 'Tu PC está en orden', 30_000);

  await page.getByRole('button', { name: /^Revisar$/ }).click();
  await waitForText(page, 'Revisión lista', 25_000);

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

  if (pageErrors.length) throw new Error(`Errores de página: ${pageErrors.join(' | ')}`);

  const admin = await context.newPage();
  await admin.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await waitForText(admin, 'Administración');
  await admin.getByRole('button', { name: 'Entrar' }).waitFor({ state: 'visible' });

  console.log('NEXO UI smoke passed: compact home, readable metrics, tools, Internet, native sensor panel and admin entry.');
  await context.close();
} finally {
  await browser.close();
}
