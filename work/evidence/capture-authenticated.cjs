const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const account = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/wacrm-evidence-account.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const report = { capturedAt: new Date().toISOString(), testEmail: account.email, checks: [], screenshots: [], errors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  const capture = async name => {
    await page.screenshot({ path: path.join(__dirname, name), fullPage: true });
    report.screenshots.push(name);
  };
  try {
    // No trace/storageState export: the login password and session tokens remain private.
    await page.goto('http://localhost:3100/login', { waitUntil: 'networkidle', timeout: 45000 });
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 45000 });
    await page.waitForLoadState('networkidle');
    await capture('08-real-test-account-dashboard.png');
    report.checks.push({ name: 'Real test user signs in', passed: true });
    await page.goto('http://localhost:3100/plan', { waitUntil: 'networkidle', timeout: 45000 });
    await page.getByRole('main').getByRole('heading', { name: 'Business plan', exact: true }).waitFor();
    await capture('09-real-business-plan.png');
    const api = await context.request.get('http://localhost:3100/api/account/plan');
    const plan = await api.json();
    report.checks.push({ name: 'Real authenticated plan API', passed: api.status() === 200 && plan.data.account_id === account.accountId, status: api.status(), data: plan.data });
    await page.goto('http://localhost:3100/api/account/plan', { waitUntil: 'networkidle' });
    await capture('10-real-business-plan-api.png');
    await page.goto('http://localhost:3100/plan', { waitUntil: 'networkidle' });
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('11-real-business-plan-mobile.png');
    await page.setViewportSize({ width: 1440, height: 1050 });

    await page.goto('http://localhost:5678', { waitUntil: 'networkidle', timeout: 45000 });
    await page.locator('input').first().waitFor({ timeout: 45000 });
    if (await page.getByText('Set up owner account', { exact: true }).count()) {
      const file = path.join(root, 'infra/n8n/.secrets/n8n-evidence-owner.json');
      let owner = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { email: account.email, password: 'Nn9!' + crypto.randomBytes(24).toString('base64url') };
      if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
      await page.getByLabel(/Email/).fill(owner.email);
      await page.getByLabel(/First Name/).fill('WACRM');
      await page.getByLabel(/Last Name/).fill('Test Operator');
      await page.getByLabel(/Password/).fill(owner.password);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.getByText('Set up owner account', { exact: true }).waitFor({ state: 'hidden', timeout: 45000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      report.checks.push({ name: 'n8n owner onboarding submitted locally', url: page.url(), renderedText: (await page.locator('body').innerText()).slice(0, 1200) });
    } else {
      const owner = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/n8n-evidence-owner.json'), 'utf8'));
      await page.getByLabel(/Email/).fill(owner.email);
      await page.getByLabel(/Password/).fill(owner.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForLoadState('networkidle');
    }
    const later = page.getByText('Set up later in Settings', { exact: true });
    if (await later.count()) { await later.click(); await page.waitForLoadState('networkidle'); }
    await page.waitForTimeout(1500);
    await capture('12-real-n8n-owner-onboarding.png');
    const readiness = await context.request.get('http://localhost:5678/healthz/readiness');
    report.checks.push({ name: 'n8n readiness', passed: readiness.status() === 200, status: readiness.status() });
    report.limitations = ['Subscription migration 056 is absent in configured Supabase; /plan shows migration required with paid features disabled.', 'No CRM-to-n8n workflows, advertising connector, checkout or global administration have been implemented yet.', 'All screenshots in this report are real services; no design prototype is used.'];
    fs.writeFileSync(path.join(__dirname, 'authenticated-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.checks.some(check => check.passed === false)) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
