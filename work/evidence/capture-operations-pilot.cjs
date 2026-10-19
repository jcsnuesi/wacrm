const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {chromium} = require(process.argv[2]);
const root = path.resolve(__dirname, '../..');
const credentials = JSON.parse(fs.readFileSync(path.join(root,'infra/n8n/.secrets/wacrm-evidence-account.json')));
const sql = spawnSync('docker',['compose','-f','infra/n8n/compose.yaml','exec','-T','postgres','psql','-qAt','-U','n8n','-d','wacrm_operations_verified'],{cwd:root,encoding:'utf8',input:`SET ROLE authenticated; SELECT set_config('test.user_id','11111111-1111-4111-8111-111111111111',false); SELECT public.ops_dashboard((SELECT id FROM test_ids WHERE name='account'));`});
if(sql.status) throw Error(sql.stderr);
const data = JSON.parse(sql.stdout.trim().split('\n').findLast(s=>s.startsWith('{')));
data.account_id = credentials.accountId;
const report = { provenance:'UI real de Next.js; sesión de prueba real; GET /api/operations sustituido por resultado de PostgreSQL local aislado. No prueba de integración con Supabase remoto ni almacenamiento.',screenshots:[],errors:[],mutations:0};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 await context.route('**/api/operations*',async route=>{
   if(route.request().method()!=='GET') {report.mutations++;return route.fulfill({status:403,json:{error:'Evidencia de lectura del piloto local'}});}
   return route.fulfill({json:{data}});
 });
 const capture=async name=>{await page.screenshot({path:path.join(__dirname,name),fullPage:true});report.screenshots.push(name);};
 try {
 await page.goto('http://localhost:3101/login',{waitUntil:'networkidle',timeout:60000});
 await page.getByLabel('Email',{exact:true}).fill(credentials.email);
 await page.getByLabel('Password',{exact:true}).fill(credentials.password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.waitForURL('**/dashboard',{timeout:60000});
 await page.goto('http://localhost:3101/operations',{waitUntil:'networkidle',timeout:60000});
 await page.getByRole('navigation',{name:'Módulos operativos'}).waitFor();
 for(const [label,file] of [['Resumen','27-operations-local-summary.png'],['Agenda','28-operations-local-agenda.png'],['Barbero','29-operations-local-professionals.png'],['Inventario','30-operations-local-inventory.png'],['Operaciones','31-operations-local-sales.png'],['Comprobantes','32-operations-local-proofs.png'],['Finanzas','33-operations-local-finance.png']]) {
   await page.getByRole('navigation',{name:'Módulos operativos'}).getByRole('button',{name:label,exact:true}).click();
   await capture(file);
 }
 await page.setViewportSize({width:390,height:844});await capture('34-operations-local-mobile.png');
 if(report.errors.length) throw Error(report.errors.join('; '));
 } catch(e){await capture('operations-local-failure.png');report.failure=e.message;process.exitCode=1;}
 finally {fs.writeFileSync(path.join(__dirname,'operations-local-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})();
