# Pruebas SQL aisladas

Estos fixtures crean prerrequisitos mínimos de Supabase y ejecutan las migraciones 056–062. Usar únicamente una base nueva y vacía; no ejecutar los fixtures contra Supabase ni una base existente del CRM.

Con PostgreSQL del compose local iniciado, desde la raíz del repositorio en PowerShell:

```powershell
$composeFile = 'infra/n8n/compose.yaml'
$testDatabase = 'wacrm_operations_acceptance_20261014'
docker compose -f $composeFile exec -T postgres mkdir -p /tmp/wacrm-operations-tests
foreach ($migration in @('056_account_subscriptions.sql','057_business_onboarding.sql','058_business_templates.sql','059_professional_role.sql','060_activity_operations.sql','061_fix_unconfigured_operations_dashboard.sql','062_employee_access.sql','030_profile_membership_sync_non_destructive.sql')) {
  docker compose -f $composeFile cp "supabase/migrations/$migration" "postgres:/tmp/wacrm-operations-tests/$migration"
}
foreach ($fixture in @('business-onboarding.sql','business-templates.sql','activity-operations.sql','operations-edges.sql','employee-access.sql')) {
  docker compose -f $composeFile cp "infra/n8n/tests/$fixture" "postgres:/tmp/wacrm-operations-tests/$fixture"
}
'DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''anon'') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''authenticated'') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''service_role'') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;' | docker compose -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U n8n -d postgres
docker compose -f $composeFile exec -T postgres createdb -U n8n $testDatabase
docker compose -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U n8n -d $testDatabase -f /tmp/wacrm-operations-tests/activity-operations.sql -f /tmp/wacrm-operations-tests/operations-edges.sql -f /tmp/wacrm-operations-tests/employee-access.sql
```

Elegir otro nombre de base si ya existe. No eliminar una base existente para repetir las pruebas. Comprobar el código de salida de cada comando; `ON_ERROR_STOP` detiene las aserciones ante errores SQL.

Los casos cubren aislamiento por negocio, permisos del profesional, reservas y conflictos de recursos, instantáneas del catálogo, cobros parciales, comprobantes pendientes y duplicados, comisiones, devolución de productos, liquidación y reintentos. Los fixtures no prueban el historial completo del esquema, los JWT reales, Storage ni políticas del proveedor de archivos; esas pruebas son obligatorias en staging antes de activar esta entrega.

`employee-auth-integration.py` cubre Auth real, correo capturado, JWT, PostgREST, contraseña, activación, cambios de permisos y suspensión. Ejecutarlo únicamente frente a una copia aislada del esquema con SMTP local de captura. Requiere `TEST_AUTH_URL`, `TEST_REST_URL`, `TEST_SERVICE_KEY` y `TEST_MAIL_JSON`; nunca imprime credenciales ni enlaces. Antes de cualquier alta exige que la API de prueba devuelva `[{"id":1}]` para la tabla exclusiva de pruebas `employee_auth_test_marker`. Esta tabla no debe crearse en producción. No utilizar claves o correos de empleados reales como datos de prueba.

El diseño y la incorporación de módulos adicionales están documentados en [EMPLOYEE_ACCESS.md](../EMPLOYEE_ACCESS.md).
