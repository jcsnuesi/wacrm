const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const credentials = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/wacrm-evidence-account.json')));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const report = { capturedAt: new Date().toISOString(), screenshots: [], errors: [], created: false };
  page.on('pageerror', e => report.errors.push(e.message));
  const capture = async file => { await page.screenshot({ path: path.join(__dirname, file), fullPage: true }); report.screenshots.push(file); };
  try {
    await page.goto('http://localhost:3101/login', { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByLabel('Email', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /WACRM Evidence Test/ }).click();
    await page.getByRole('menuitem', { name: 'Crear negocio', exact: true }).click();
    await page.getByLabel('Nombre del negocio', { exact: true }).fill('Inmobiliaria Horizonte');
    await page.getByLabel('Rubro', { exact: true }).fill('Inmobiliaria');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Objetivo principal', { exact: true }).selectOption('rent');
    await capture('21-real-template-objective.png');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    assert.equal(await page.getByLabel('Plantilla inicial', { exact: true }).inputValue(), 'real_estate');
    await page.getByLabel('Etapa 1', { exact: true }).fill('Nueva consulta');
    await capture('22-real-template-preview.png');
    await page.getByLabel('Plantilla inicial', { exact: true }).selectOption('blank');
    assert.equal(await page.getByLabel('Etapa 1', { exact: true }).count(), 0);
    await capture('23-real-template-blank.png');
    await page.getByLabel('Plantilla inicial', { exact: true }).selectOption('real_estate');
    await page.getByLabel('Etapa 1', { exact: true }).fill('Nueva consulta');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await capture('24-real-template-review.png');
    const responsePending = page.waitForResponse(r => r.url().endsWith('/api/account/businesses') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crear y abrir negocio', exact: true }).click();
    const response = await responsePending;
    report.status = response.status(); report.result = await response.json();
    const sent = response.request().postDataJSON();
    assert.equal(sent.objective, 'rent'); assert.equal(sent.template_id, 'real_estate'); assert.equal(sent.stage_names[0], 'Nueva consulta');
    if (response.status() === 201) { report.created = true; await page.waitForURL('**/plan'); }
    else { assert.equal(report.result.code, 'migration_required'); await page.getByRole('alert').waitFor(); }
    await capture('25-real-template-result.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('26-real-template-mobile.png');
    report.checks = ['Inmobiliaria sugerida por rubro', 'Objetivo alquiler', 'Edición de etapas', 'Desde cero sin etapas', 'Solicitud con plantilla, versión y objetivo'];
    fs.writeFileSync(path.join(__dirname, 'templates-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) { await capture('templates-failure.png'); console.error(error.message); process.exitCode = 1; }
  finally { await browser.close(); }
})();
