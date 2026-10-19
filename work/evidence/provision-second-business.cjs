const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
require('@next/env').loadEnvConfig(root);
const { createClient } = require('@supabase/supabase-js');
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const schema = await db.from('account_members').select('account_id').limit(0);
  if (schema.error) throw new Error('Membership schema unavailable: ' + schema.error.code);
  const first = JSON.parse(fs.readFileSync(path.join(root, 'infra/n8n/.secrets/wacrm-evidence-account.json')));
  const file = path.join(root, 'infra/n8n/.secrets/wacrm-second-evidence-account.json');
  let second = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { email: `wacrm-evidence-b-${Date.now()}@example.com`, password: 'Wa9!' + crypto.randomBytes(24).toString('base64url') };
  fs.writeFileSync(file, JSON.stringify(second));
  if (!second.userId) {
    const result = await db.auth.admin.createUser({ email: second.email, password: second.password, email_confirm: true, user_metadata: { full_name: 'WACRM Test Business B', purpose: 'playwright-evidence' } });
    if (result.error) throw new Error(result.error.message);
    second.userId = result.data.user.id;
    fs.writeFileSync(file, JSON.stringify(second));
  }
  const profile = await db.from('profiles').select('account_id').eq('user_id', second.userId).single();
  if (profile.error) throw new Error(profile.error.message);
  second.accountId = profile.data.account_id;
  fs.writeFileSync(file, JSON.stringify(second));
  for (const [account, name] of [[first, 'WACRM Test Business A'], [second, 'WACRM Test Business B']]) {
    const renamed = await db.from('accounts').update({ name }).eq('id', account.accountId).eq('owner_user_id', account.userId);
    if (renamed.error) throw new Error(renamed.error.message);
  }
  const membership = await db.from('account_members').upsert({ account_id: second.accountId, user_id: first.userId, role: 'admin' }, { onConflict: 'account_id,user_id' });
  if (membership.error) throw new Error(membership.error.message);
  const list = await db.from('account_members').select('account_id,role').eq('user_id', first.userId);
  if (list.error) throw new Error(list.error.message);
  console.log(JSON.stringify({ testBusinesses: list.data, secondBusinessCreated: true, sameLoginHasBothMemberships: true }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
