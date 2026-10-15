# n8n Community: piloto local gestionado

Esta configuración prepara una instancia operada por nuestro equipo. No publica un editor para clientes, no cobra, no aplica migraciones Supabase y no cambia el motor de Automations existente.

Desde la raíz, crear secretos locales sin mostrarlos en pantalla:

```powershell
New-Item -ItemType Directory -Force infra/n8n/.secrets | Out-Null
node -e "const fs=require('fs'),crypto=require('crypto'); for(const name of ['database-password','encryption-key','runner-token']) { const p='infra/n8n/.secrets/'+name; if(!fs.existsSync(p)) fs.writeFileSync(p,crypto.randomBytes(32).toString('hex'),{flag:'wx'}); }"
docker compose -f infra/n8n/compose.yaml config --quiet
docker compose -f infra/n8n/compose.yaml up -d
docker compose -f infra/n8n/compose.yaml ps
```

Abrir `http://localhost:5678` y completar el alta del propietario operador. Solo está expuesto en loopback. Los volúmenes persisten al reiniciar; no usar `down -v` para actualizar. Guardar la clave de cifrado y backups de PostgreSQL/volúmenes; perder la clave inutiliza las credenciales cifradas.

Los archivos `.secrets` no se versionan ni se incluyen en la imagen del CRM. Compose monta secretos como archivos; en Windows verificar permisos efectivos del host. Esta configuración no inicia sandbox privilegiado ni monta Docker socket. Los nodos de código, comandos y archivos están excluidos para este primer piloto. Se selecciona modo de runners externo, sin lanzar runners: antes de habilitar nodos Code se necesita un runner separado con autenticación y permisos limitados. No se permiten paquetes comunitarios no verificados.

Para producción: seleccionar y verificar versiones/digests, HTTPS, cookies seguras, URL pública/proxy correctos, políticas de salida, base con usuario de privilegios mínimos, backups/restauración y monitoreo. PostgreSQL aquí es una base aislada de piloto con usuario bootstrap; no trasladar esa configuración sin endurecerla. No exponer este Compose local directamente a internet.

WACRM aún no envía eventos a esta instancia. Los webhooks generales rechazan localhost y redes privadas: fase 3 requiere outbox/adaptador controlado; no eliminar la protección SSRF. La consola administrativa resiliente se construirá como servicio separado, no dentro de este contenedor.

La edición de workflows por clientes necesita contrato adecuado con n8n y habilitación por negocio. Un upgrade comercial en WACRM no activa por sí solo derechos de licencia.

Referencias: [Docker Compose](https://docs.n8n.io/deploy/host-n8n/install-options/install-using-docker-compose.md), [variables por archivo](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables.md), [licencia](https://docs.n8n.io/n8n-community-license/community-license/license-faq.md).

## Prueba de migración

`tests/subscription-migration.sql` se ejecuta exclusivamente en una base nueva de prueba, con prerrequisitos mínimos. Crea roles de fixture: no usarlo en Supabase ni en un servidor que ya tenga esos roles. Copiar también `supabase/migrations/056_account_subscriptions.sql` al mismo directorio del contenedor y ejecutar con `psql -v ON_ERROR_STOP=1`. Valida aislamiento RLS, privilegios de escritura y el trigger de alta; la cadena completa de migraciones se prueba por separado en staging.
