const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const first = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/wacrm-evidence-account.json')));
const second = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/wacrm-second-evidence-account.json')));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const report = { capturedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [] };
  page.on('pageerror', e => report.errors.push(e.message));
  const capture = async name => { await page.screenshot({ path: path.join(__dirname, name), fullPage: true }); report.screenshots.push(name); };
  const active = async () => await (await context.request.get('http://localhost:3100/api/account/active')).json();
  try {
    await page.goto('http://localhost:3100/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Email', { exact: true }).fill(first.email);
    await page.getByLabel('Password', { exact: true }).fill(first.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/dashboard');
    await page.goto('http://localhost:3100/plan', { waitUntil: 'networkidle' });
    const initial = await active();
    console.log(JSON.stringify({ initial }));
    assert.equal(initial.available_accounts.length, 2);
    await page.getByRole('button', { name: /WACRM Evidence Test/ }).click();
    await page.getByRole('menuitem', { name: 'WACRM Test Business B', exact: true }).waitFor();
    await capture('13-real-multi-account-dropdown.png');
    for (const [account, name, screenshot] of [[second, 'WACRM Test Business B', '14-real-business-b-active.png'], [first, 'WACRM Test Business A', '15-real-business-a-active.png']]) {
      if (name.endsWith('A')) await page.getByRole('button', { name: /WACRM Evidence Test/ }).click();
      const response = page.waitForResponse(r => r.url().endsWith('/api/account/active') && r.request().method() === 'POST');
      await page.getByRole('menuitem', { name, exact: true }).click();
      assert.equal((await response).status(), 200);
      await page.waitForLoadState('networkidle');
      const selected = await active();
      assert.equal(selected.account_id, account.accountId);
      await page.goto('http://localhost:3100/plan', { waitUntil: 'networkidle' });
      const plan = (await (await context.request.get('http://localhost:3100/api/account/plan')).json()).data;
      assert.equal(plan.account_id, account.accountId);
      await page.getByRole('main').getByText(new RegExp(name)).waitFor();
      await capture(screenshot);
      report.checks.push({ name: 'UI switches active business and plan API context', business: name, accountId: selected.account_id, role: selected.role, passed: true });
    }
    report.limitations = ['Selector is in the sidebar user menu.', 'Business creation onboarding remains pending.', 'Subscription migration has not been applied to this Supabase.'];
    fs.writeFileSync(path.join(__dirname, 'multi-account-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (e) { await capture('multi-account-failure.png'); console.error(e.message); process.exitCode = 1; }
  finally { await browser.close(); }
})();
