const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const account = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/wacrm-evidence-account.json')));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const report = { capturedAt: new Date().toISOString(), screenshots: [], errors: [], created: false };
  page.on('pageerror', error => report.errors.push(error.message));
  const capture = async file => { await page.screenshot({ path: path.join(__dirname, file), fullPage: true }); report.screenshots.push(file); };
  try {
    await page.goto('http://localhost:3101/login', { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /WACRM Evidence Test/ }).click();
    await page.getByRole('menuitem', { name: 'Crear negocio', exact: true }).waitFor();
    await capture('16-real-create-business-selector.png');
    await page.getByRole('menuitem', { name: 'Crear negocio', exact: true }).click();
    await page.getByLabel('Nombre del negocio', { exact: true }).fill('Academia Horizonte');
    await page.getByLabel('Rubro', { exact: true }).fill('Educación y formación');
    await capture('17-real-create-business-details.png');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await capture('18-real-create-business-plan.png');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await capture('19-real-create-business-review.png');
    const pending = page.waitForResponse(r => r.url().endsWith('/api/account/businesses') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Crear y abrir negocio', exact: true }).click();
    const response = await pending;
    const payload = await response.json();
    report.status = response.status(); report.result = payload;
    if (response.status() === 201) {
      report.created = true;
      await page.waitForURL('**/plan');
      await page.waitForLoadState('networkidle');
      const active = await (await context.request.get('http://localhost:3101/api/account/active')).json();
      assert.equal(active.account_id, payload.account_id);
      assert.equal(active.role, 'owner');
      report.activeBusiness = active.account;
      await capture('20-real-new-business-created.png');
    } else {
      assert.equal(payload.code, 'migration_required');
      await page.getByRole('alert').waitFor();
      await capture('20-real-create-business-setup-pending.png');
    }
    fs.writeFileSync(path.join(__dirname, 'create-business-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) { await capture('create-business-failure.png'); console.error(error.message); process.exitCode = 1; }
  finally { await browser.close(); }
})();
