# Actividades, operación y finanzas por negocio

Rama: `plantillas`. Implementación: 14 de octubre de 2026.

WACRM conserva un núcleo agnóstico. Cada negocio elige su actividad principal en un select y puede combinar actividades adicionales. En esta entrega existen Servicios y Venta de productos. El rubro y la plantilla comercial siguen siendo metadatos y configuración inicial; no conceden permisos por sí solos.

## Ocho fases de esta propuesta

| Fase | Entrega implementada                                                                           | Verificación actual                                                                      |
| ---- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1    | Catálogo de actividades, onboarding, configuración y módulos por negocio                       | Pruebas de API y SQL aislado                                                             |
| 2    | Profesionales: perfil, horarios semanales, porcentajes separados y acceso opcional restringido | SQL de permisos, porcentajes históricos y aislamiento                                    |
| 3    | Servicios, estaciones, agenda interna y enlace público con disponibilidad                      | SQL de colisiones, recursos, reservas e idempotencia; API pública probada                |
| 4    | Inventario, productos vendidos e insumos consumidos, atribución al profesional                 | SQL de existencias, consumo, devolución y rollback                                       |
| 5    | Cierre de servicio/venta, descuentos, vínculo con oportunidad y cuentas por cobrar             | SQL: completar no supone cobrar; cierre repetido no duplica movimientos                  |
| 6    | Comprobantes privados pendientes, revisión del propietario/administrador y cobros confirmados  | Pruebas de API de archivo y SQL de revisión/deduplicación; almacenamiento real pendiente |
| 7    | Comisiones sobre cobros netos, ajustes por devoluciones y liquidaciones manuales               | SQL de cobros parciales, porcentajes conservados y saldo negativo tras devolución        |
| 8    | Historial mensual, finanzas, permisos y evidencia de interfaz                                  | 848 pruebas unitarias; build de producción y lint correctos; capturas con Playwright     |

Estas ocho fases corresponden a la propuesta operativa actual. No reemplazan las fases OaaS de integración n8n, facturación comercial, publicidad o consola administrativa, que conservan su estado en `IMPLEMENTATION_OAAS.md`.

## Reglas del producto

- Servicios habilita profesionales, catálogo y agenda. Venta de productos habilita ventas e inventario. Se pueden combinar. Agenda y venta de productos se pueden desactivar conservando datos; los registros financieros y de inventario necesarios para su integridad permanecen.
- No se insertan profesionales, precios o productos ficticios al crear un negocio. El cliente define los suyos; las etiquetas del profesional son configurables.
- Cada negocio mantiene configuración, profesionales, inventario, comprobantes, cobros y comisiones propios. Cambiar de negocio descarta formularios pendientes y refresca el contexto.
- Un perfil profesional puede vincularse a un usuario ya registrado por correo, sin reemplazar sus membresías de otros negocios. Solo ve su operación. Las invitaciones generales no conceden este rol; se asigna desde Operación.
- La reserva pública agenda un servicio con un profesional; la agenda interna admite varios servicios del mismo profesional. Ambos controles comprueban horario, duración y recursos. El enlace público está deshabilitado inicialmente.
- La cita conserva precios, duración e insumos originales. El cierre conserva costos y porcentajes. Cambios futuros del catálogo no reescriben ventas anteriores.
- Completar una oportunidad requiere cerrar su operación si se configuró la etapa final. Cobrar es otra acción: se admiten anticipos, pagos parciales y devoluciones.
- Un comprobante no acredita dinero. El administrador verifica el depósito, registra el importe real y deja una nota. Se bloquea reutilizar el mismo archivo o mensaje confirmado; referencias repetidas requieren revisión explícita.
- Los adjuntos entrantes de imagen/documento permiten iniciar el registro desde el inbox. Se copia el archivo cuando el proveedor lo permite; si no está disponible se solicita descargarlo y adjuntarlo. La carga manual admite PDF, JPG, PNG y WebP hasta 5 MB, con comprobación de firma y almacenamiento privado.
- Las comisiones se calculan sobre el valor neto efectivamente cobrado de operaciones completadas, distribuido en unidades monetarias menores. Las devoluciones generan ajustes; las liquidaciones registran pagos manuales, no transferencias bancarias.
- Las finanzas separan ventas, cobros, anticipos, saldo por cobrar, costos, gastos y comisiones. El resultado es estimado, no un saldo bancario ni contabilidad fiscal. La moneda queda fijada para evitar mezclar históricos; cambiarla en el ajuste general bloquea estas operaciones hasta restaurarla.

## Activación pendiente en Supabase

El código está implementado y validado localmente. Las migraciones no están aplicadas a la base remota conectada. Todavía no hay despliegue de esta entrega.

1. Tomar un respaldo y ejecutar primero en un Supabase de staging con el historial completo de migraciones del proyecto.
2. Aplicar en orden las pendientes `056_account_subscriptions.sql`, `057_business_onboarding.sql`, `058_business_templates.sql`, `059_professional_role.sql` y `060_activity_operations.sql`.
3. Confirmar y cerrar la transacción de 059 antes de ejecutar 060: PostgreSQL debe confirmar el nuevo valor del enum antes de utilizarlo.
4. Recargar el esquema de PostgREST si el entorno no lo hace automáticamente. Comprobar el bucket privado `ops-proofs` y la clave de servicio solo en servidor.
5. Habilitar el selector con `WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=true` y `NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=true`; compilar y desplegar el artefacto.
6. Verificar con dos negocios y tres roles: administrador, recepción/agente y profesional. Probar cargas y enlaces firmados reales, reserva pública concurrente, cambio de negocio, cobro y devolución. Probar también suspensión del plan.

Las tablas operativas no permiten escrituras directas desde clientes autenticados. Las operaciones pasan por RPC con validación de membresía, actividad, plan, rol y claves de idempotencia. Los endpoints privados usan el negocio activo de la sesión, y los públicos solo exponen catálogo y disponibilidad permitidos.

## Evidencia y límites de las pruebas

La revisión completa con ESLint terminó sin errores y con 49 advertencias en el código de `src`; la revisión específica de los nuevos módulos operativos no produjo advertencias. La compilación final de Next.js y TypeScript terminó correctamente.

`infra/n8n/tests/activity-operations.sql` y `operations-edges.sql` ejecutan los casos de negocio y permisos en PostgreSQL aislado con prerrequisitos mínimos de Supabase. No sustituyen una migración de staging con el historial completo, autenticación real del profesional y Storage.

Las capturas `work/evidence/27-operations-local-summary.png` a `34-operations-local-mobile.png` muestran la interfaz real con sesión de prueba. Para esta evidencia, Playwright sustituye la respuesta de lectura de `/api/operations` por un resultado real de la base PostgreSQL aislada, ajustando el identificador al negocio de prueba de la sesión. No se ejecutaron mutaciones a través del navegador ni se conectaron los módulos nuevos a Supabase remoto. El detalle está en `work/evidence/operations-local-report.json`.

Los listados del panel tienen límites de registros; los agregados financieros se calculan sobre los registros completos. Paginación avanzada, festivos, varios intervalos por día, nómina, impuestos, conciliación bancaria automática y edición de workflows n8n no forman parte de esta entrega.
