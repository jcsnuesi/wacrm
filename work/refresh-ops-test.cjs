const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/060_activity_operations.sql', 'utf8');
fs.writeFileSync('work/ops-functions.sql', '\\set ON_ERROR_STOP on\n' + [...sql.matchAll(/CREATE FUNCTION[\s\S]+?\$\$;/g)].map(m => m[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')).join('\n'));
const test = fs.readFileSync('infra/n8n/tests/activity-operations.sql','utf8');
fs.writeFileSync('work/ops-body.sql', '\\set ON_ERROR_STOP on\n' + test.slice(test.indexOf('SET ROLE authenticated;')));
