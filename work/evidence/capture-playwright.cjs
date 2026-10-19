const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

(async () => {
  const output = __dirname;
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const report = { capturedAt: new Date().toISOString(), checks: [], screenshots: [], pageErrors: [] };
  page.on('pageerror', error => report.pageErrors.push(error.message));
  async function screenshot(name) {
    await page.screenshot({ path: path.join(output, name), fullPage: true });
    report.screenshots.push(name);
  }
  try {
    await page.goto('http://localhost:3100/plan', { waitUntil: 'networkidle', timeout: 45000 });
    report.checks.push({ name: 'Real WACRM /plan requires authentication', passed: new URL(page.url()).pathname === '/login', url: page.url(), renderedText: (await page.locator('body').innerText()).slice(0, 1000) });
    await screenshot('01-wacrm-auth-required.png');
    const api = await context.request.get('http://localhost:3100/api/account/plan');
    report.checks.push({ name: 'Real business plan API rejects anonymous access', passed: api.status() === 401, status: api.status() });
    const readiness = await context.request.get('http://localhost:5678/healthz/readiness');
    report.checks.push({ name: 'Real n8n database readiness', passed: readiness.status() === 200, status: readiness.status() });
    await page.goto('http://localhost:5678', { waitUntil: 'networkidle', timeout: 45000 });
    report.checks.push({ name: 'Real n8n UI loaded; owner setup may be pending', url: page.url(), renderedText: (await page.locator('body').innerText()).slice(0, 1000) });
    await screenshot('02-n8n-real-ui.png');

    // Separate design prototype, never presented as deployed functionality.
    await page.setContent(fs.readFileSync(path.join(output, '..', 'wacrm-negocios-ui.html'), 'utf8'), { waitUntil: 'networkidle' });
    const root = page.locator('#wacrm-business-preview');
    await root.getByRole('button', { name: 'Publicidad', exact: true }).click();
    await root.getByRole('heading', { name: 'Del anuncio a la venta' }).waitFor();
    await screenshot('03-prototype-advertising.png');
    await root.getByLabel('Cambiar negocio').selectOption('academia');
    await root.getByRole('heading', { name: 'Activa Publicidad para este negocio' }).waitFor();
    report.checks.push({ name: 'Prototype only: switching business changes paid capabilities', passed: true });
    await screenshot('04-prototype-isolated-business.png');
    await root.getByRole('button', { name: '＋ Crear otro negocio', exact: true }).click();
    await root.getByLabel('Nombre del negocio').fill('Negocio de prueba Playwright');
    await root.getByLabel('Rubro', { exact: true }).fill('Servicios');
    await root.getByRole('button', { name: 'Elegir plan', exact: true }).click();
    await screenshot('05-prototype-onboarding.png');
    await root.locator('[data-plan="CRM + Publicidad"]').click();
    await root.getByRole('button', { name: 'Revisar alta' }).click();
    await root.getByRole('button', { name: 'Crear negocio de demostración' }).click();
    await root.getByRole('heading', { name: 'Negocio de prueba Playwright' }).waitFor();
    report.checks.push({ name: 'Prototype only: new business has no inherited connections', passed: (await root.innerText()).includes('Sin cuenta vinculada') });
    await root.getByRole('button', { name: 'Administración de plataforma' }).click();
    await root.getByRole('heading', { name: 'Negocios y suscripciones' }).waitFor();
    await root.locator('[data-suspend="academia"]').click();
    await root.getByLabel('Motivo de suspensión').fill('Prueba local de interfaz; no modifica cuentas reales');
    await screenshot('06-prototype-admin.png');
    await root.getByRole('button', { name: 'Confirmar simulación' }).click();
    report.checks.push({ name: 'Prototype only: suspension confirmation changes local state', passed: (await root.innerText()).includes('Suspendido') });
    await page.setViewportSize({ width: 390, height: 844 });
    await root.getByRole('button', { name: 'Volver al negocio' }).click();
    await screenshot('07-prototype-mobile.png');
    report.checks.push({ name: 'Prototype mobile has no horizontal overflow', passed: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) });
    report.limitations = ['The authenticated real /plan screen cannot be verified without a user session.', 'Screenshots 03–07 are the design prototype with fictitious data, not the implemented CRM.', 'No user was created, no credentials submitted, no Supabase migration applied, no real billing/suspension/notification occurred.'];
    await context.tracing.stop({ path: path.join(output, 'playwright-trace.zip') });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.checks.some(check => check.passed === false)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
