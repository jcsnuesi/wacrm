const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
require('@next/env').loadEnvConfig(root);
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase configuration missing');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const schema = await db.from('account_subscriptions').select('account_id').limit(0);
  console.log(JSON.stringify({ supabaseHost: new URL(url).hostname, subscriptionSchemaAvailable: !schema.error, schemaErrorCode: schema.error?.code || null }));
  if (process.argv.includes('--inspect')) return;
  const secretPath = path.join(root, 'infra/n8n/.secrets/wacrm-evidence-account.json');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  let account;
  if (fs.existsSync(secretPath)) account = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
  else {
    account = { email: `wacrm-evidence-${Date.now()}@example.com`, password: 'Wa9!' + crypto.randomBytes(24).toString('base64url'), created: false };
    fs.writeFileSync(secretPath, JSON.stringify(account), { flag: 'wx' });
  }
  if (!account.created) {
    const result = await db.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true, user_metadata: { full_name: 'WACRM Evidence Test', purpose: 'playwright-evidence' } });
    if (result.error) throw new Error('Test user creation failed: ' + result.error.message);
    account.userId = result.data.user.id;
    account.created = true;
    fs.writeFileSync(secretPath, JSON.stringify(account));
  }
  const profile = await db.from('profiles').select('account_id, account_role').eq('user_id', account.userId).single();
  if (profile.error) throw new Error('Test user profile unavailable: ' + profile.error.message);
  account.accountId = profile.data.account_id;
  fs.writeFileSync(secretPath, JSON.stringify(account));
  console.log(JSON.stringify({ created: true, email: account.email, accountId: account.accountId, subscriptionSchemaAvailable: !schema.error, credentialsStoredLocally: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
