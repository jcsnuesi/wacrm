# Pruebas SQL aisladas

Estos fixtures crean prerrequisitos mínimos de Supabase y ejecutan las migraciones 056–060. Usar únicamente una base nueva y vacía; no ejecutar los fixtures contra Supabase ni una base existente del CRM.

Con PostgreSQL del compose local iniciado, desde la raíz del repositorio en PowerShell:

```powershell
$composeFile = 'infra/n8n/compose.yaml'
$testDatabase = 'wacrm_operations_acceptance_20261014'
docker compose -f $composeFile exec -T postgres mkdir -p /tmp/wacrm-operations-tests
foreach ($migration in @('056_account_subscriptions.sql','057_business_onboarding.sql','058_business_templates.sql','059_professional_role.sql','060_activity_operations.sql')) {
  docker compose -f $composeFile cp "supabase/migrations/$migration" "postgres:/tmp/wacrm-operations-tests/$migration"
}
foreach ($fixture in @('business-onboarding.sql','business-templates.sql','activity-operations.sql','operations-edges.sql')) {
  docker compose -f $composeFile cp "infra/n8n/tests/$fixture" "postgres:/tmp/wacrm-operations-tests/$fixture"
}
'DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''anon'') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''authenticated'') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=''service_role'') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;' | docker compose -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U n8n -d postgres
docker compose -f $composeFile exec -T postgres createdb -U n8n $testDatabase
docker compose -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U n8n -d $testDatabase -f /tmp/wacrm-operations-tests/activity-operations.sql -f /tmp/wacrm-operations-tests/operations-edges.sql
```

Elegir otro nombre de base si ya existe. No eliminar una base existente para repetir las pruebas. Comprobar el código de salida de cada comando; `ON_ERROR_STOP` detiene las aserciones ante errores SQL.

Los casos cubren aislamiento por negocio, permisos del profesional, reservas y conflictos de recursos, instantáneas del catálogo, cobros parciales, comprobantes pendientes y duplicados, comisiones, devolución de productos, liquidación y reintentos. Los fixtures no prueban el historial completo del esquema, los JWT reales, Storage ni políticas del proveedor de archivos; esas pruebas son obligatorias en staging antes de activar esta entrega.
