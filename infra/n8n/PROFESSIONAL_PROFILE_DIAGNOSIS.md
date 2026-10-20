# Diagnóstico: perfil profesional, clientes y comisiones

Fecha: 19 de octubre de 2026, America/Santo_Domingo.

Alcance: inspección del repositorio, incluidos los cambios locales de acceso de empleados (062). No se modificó producto, no se ejecutaron migraciones y no se desplegó esta propuesta. Los nombres señalados como **propuestos** aún no existen. Este diagnóstico no certifica la configuración de cada canal en producción.

## Componentes existentes

| Área | Implementación real | Uso y límite actual |
| --- | --- | --- |
| UI operativa | `src/app/(dashboard)/operations/page.tsx`, `src/components/operations/workspace.tsx` | Tarjetas, formulario, agenda, operaciones y finanzas dentro de una sola pantalla. No existe ruta individual de profesional. |
| API y comandos | `src/app/api/operations/route.ts`, `src/lib/operations/server.ts`, `ops_command`, `ops_command_core` | Comandos con autorización, aislamiento, auditoría, idempotencia y bloqueo transaccional por negocio. |
| Profesionales | `ops_professionals`, `ops_professional_services` | Nombre, especialidad, foto, horario, activo, usuario asociado y porcentajes generales de servicios/productos. No hay archivo, motivo de salida o reglas por servicio con vigencia. |
| Acceso | `062_employee_access.sql`, `ops_employee_access`, `employee_module_catalog`, `ops_employee_can` | Invitación, activación, suspensión y permisos por módulo comprobados en backend. Reutilizar sin elevar empleados a agentes. |
| Clientes canónicos | `045_customer_360_core.sql`, `customers`, `contact_identities`, `contacts.customer_id` | Customer 360 e identidad entre canales ya existen. |
| Clientes operativos | `ops_clients` | Directorio separado por negocio/teléfono. No contiene vínculo con `customers`. Nombre y teléfono obligatorios en las reservas. |
| Agenda | `ops_appointments`, `ops_book`, `ops_slot_available` | Estados, servicios con instantánea, horarios, profesional activo, servicio habilitado y comprobación de solapamiento bajo bloqueo. Una cita tiene un profesional. |
| Reserva pública | `src/app/api/booking/[slug]/route.ts`, `ops_public_book`, `ops_public_slots` | Reutiliza `ops_book`; reintentos idempotentes. La API pública permite un servicio por reserva. |
| Cobros | `ops_operations`, `ops_lines`, `ops_payments`, `ops_adjustments` | Cierre, descuento, cobros parciales, devoluciones y atribución por línea. El cobro tiene fecha de registro, sin fecha efectiva independiente. |
| Comisiones | `ops_recalculate`, `ops_line_collected`, `ops_commissions`, `src/lib/operations/finance.ts` | Se generan tras cierre y cobro; reparto proporcional con residuos en unidades menores, porcentaje histórico por línea y ajustes de comisión por devolución. |
| Pago al profesional | `ops_settlements`, comando `settle` | Pago global contra saldo del profesional, admite importe parcial, impide superar saldo y permite pagar a inactivos. No reserva ni asigna comisiones específicas. |
| Comprobantes | `ops_proofs`, `src/app/api/operations/proofs/route.ts`, bucket `ops-proofs` | Archivos privados con autorización, firma/tipo, tamaño máximo de 5 MB y hash. Son comprobantes de cobros al cliente, no de pagos al profesional. |
| IA | `src/lib/ai/auto-reply.ts`, `generate.ts`, `providers/shared.ts` | Respuesta textual, conocimiento y traspaso a humano. No existe contrato ni ejecución de herramientas de reserva. |
| Canales | `src/lib/channels/*`, webhooks existentes | WhatsApp y proveedores sociales; el despacho de respuesta automática revisado cubre WhatsApp e Instagram. Facebook requiere integración explícita del flujo IA. TikTok es un adaptador sin mensajería habilitada, no una integración operativa completa. |

## Brechas por etapa

### 2. Perfil y ciclo de vida: parcial

Faltan tarjeta navegable por teclado, URL propia, pestañas, contacto independiente del acceso, archivo, salida motivada y eliminación segura sin dependencias. La desactivación ya impide nuevas reservas y el acceso operativo del profesional; no borra la identidad global ni los otros negocios.

Falta presentar todas las citas futuras y ofrecer resolución administrativa explícita. No basta desactivar: `ops_close` también exige profesional activo al preparar líneas, por lo que el tratamiento de citas pendientes debe definirse. Se necesita reasignación atómica con servicio, horario y recurso nuevamente validados. No cancelar, sustituir ni notificar automáticamente.

### 3. Cartera y reservas multicanal: incompleta

La reserva manual y la pública ya comparten `ops_book`. Falta conectar la IA con ese núcleo y vincular `ops_clients` con Customer 360. Actualmente el teléfono obligatorio dificulta reservar directamente con una identidad social que no lo tenga.

No existe la consulta de cartera con primera/última atención, próxima cita, servicios, canal de primera reserva y estado reservado/atendido. Tampoco existe reasignación como comando. `source` solo admite `crm/public`; no identifica WhatsApp, Instagram, conversación, mensaje o actor IA. El creador de `ops_operations` no sustituye esa procedencia.

Reutilizar las identidades verificables ya persistidas; nunca fusionar por nombre. Las cancelaciones e inasistencias deben excluirse de atenciones. Una cartera derivada de citas vigentes y servicios completados evita mantener una tabla duplicada susceptible de quedar desactualizada.

### 4. Atenciones y reglas: parcial

Ya existen líneas por servicio, tasa histórica, generación proporcional al cobro y ajustes negativos tras reembolsos. Faltan excepciones por servicio, vigencias, identificación histórica de la regla/base y detalle del cobro atribuible a cada evento cuando se necesite explicarlo históricamente.

No hay campos separados para impuestos o propinas en este contexto; no puede afirmarse que estén excluidos de importes introducidos externamente. Debe confirmarse el tratamiento antes de habilitar esos casos.

El dashboard mensual limita varias listas a 500 filas (comprobantes a 200). No sirve como contrato de reportes completos. Faltan filtros por rango y estado, búsqueda, orden, paginación, totales backend del conjunto filtrado y exportación. Deben distinguirse fecha de atención, cierre, cobro y pago al profesional.

Riesgo concreto de presentación: el historial de cada profesional en `workspace.tsx` muestra `o.collected_minor` en cada línea. En operaciones de varios servicios esto repite el total cobrado y puede inducir a atribuirlo varias veces. El detalle nuevo debe usar `ops_line_collected` o una asignación persistida equivalente. El resumen de operaciones del profesional también debe revisarse para usar el mismo redondeo exacto por línea.

Moneda y precisión: importes `BIGINT` en unidades menores, porcentajes en puntos básicos, cantidades `NUMERIC`, fechas `TIMESTAMPTZ` y zona de `ops_config`. La moneda del negocio se protege contra cambios incompatibles. Reutilizar esos mecanismos; no introducir flotantes monetarios. El puente a oportunidades contiene una conversión especial JPY/otras monedas que debe revisarse si se habilitan monedas de tres decimales.

### 5. Liquidaciones completas: mayormente pendiente

La funcionalidad actual denominada liquidación solo inserta un pago con profesional, importe, referencia obligatoria, autor y fecha de registro. No distingue borrador de liquidación y pago monetario.

Faltan selección/reserva de comisiones, período, detalle de servicios, asignaciones de cada pago, fecha efectiva, método, notas, referencia opcional, comprobante opcional, anulaciones con motivo y restitución de saldo. La protección actual por saldo e idempotencia sirve como base; aún hay que probar la concurrencia del modelo ampliado.

No reutilizar `ops_proofs` sin adaptar su contrato: exige operación y archivo o mensaje de origen. Un pago al profesional debe poder registrarse sin adjunto.

### 6. Entrega integral: pendiente para el nuevo alcance

Hay pruebas unitarias y fixtures SQL de operaciones, además de integración aislada de Auth para empleados. Esto no demuestra reservas reales por cada canal, el perfil móvil, liquidaciones por servicio o los escenarios concurrentes nuevos. Sigue pendiente CSV con protección de fórmulas, accesibilidad, pruebas de Storage y recorridos completos de los canales efectivamente habilitados.

## Diseño propuesto, incremental

### A. Perfil y ciclo de vida

- Ruta nueva **propuesta**: `/operations/professionals/[id]`, con página en `src/app/(dashboard)/operations/professionals/[id]/page.tsx` y componente en `src/components/operations/professional-profile.tsx`.
- API nueva **propuesta**: `/api/operations/professionals/[id]`; devuelve datos autorizados del perfil. Acciones siguen entrando por `/api/operations` y su lista de comandos.
- Añadir campos **propuestos** a `ops_professionals`: `contact_email`, `contact_phone`, `archived_at`, `deactivated_at`, `deactivated_by`, `deactivation_reason`. El correo de contacto no equivale al correo de acceso.
- Nuevos comandos **propuestos** para archivar/reactivar/eliminar y reasignar cita. Bloquear profesional/negocio, comprobar dependencias y FK antes de eliminar. Si hay atenciones, pagos, comisiones, citas o auditoría que deba conservarse, mantener el registro.
- Ampliar `ops_audit` con detalle estructurado **propuesto** para motivo y cambios relevantes, sin secretos. Mantener `active` compatible con el código existente.

### B. Identidad, cartera y confirmación

- Añadir `customer_id` nullable **propuesto** a `ops_clients`, con FK compuesta `(account_id, customer_id)` hacia `customers(account_id, id)` mediante una clave única compatible.
- No imponer exclusividad cliente-profesional ni modificar responsable comercial. Resolver duplicados de `ops_clients` antes de cualquier restricción única por cliente canónico.
- Preferir una consulta RPC **propuesta** `ops_professional_clients`, con una fila por cliente y profesional, agregada desde citas vigentes y operaciones completadas. Solo añadir tabla materializada si el volumen medido lo justifica.
- Añadir procedencia **propuesta** a citas: `booking_channel`, `actor_type`, `created_by`, `conversation_id`, `source_message_id`; conservar `source` para compatibilidad.
- Extender `ops_book` para recibir identidad canónica autorizada y registrar la vinculación en la misma transacción. Mantener bloqueo de cuenta, validación de disponibilidad e idempotencia de `ops_requests`.
- En reasignación, actualizar la atribución operativa y las instantáneas de manera consistente; no mover servicios ya completados ni borrar historia. Emitir auditoría dentro de la transacción.
- Incorporar herramientas IA **propuestas** de consulta de disponibilidad, confirmación y reasignación a través de un ejecutor acotado por negocio, conversación y cliente. No conceder al modelo acceso SQL general ni comandos financieros. Extender los adaptadores existentes de IA; mantener el proveedor configurable.

### C. Atenciones y reglas

- Consulta RPC **propuesta** `ops_professional_attentions`: filtros y paginación backend, totales independientes de la página, orden estable y una fila por línea de servicio. Endpoint **propuesto** bajo `/api/operations/professionals/[id]/attentions`.
- Tabla **propuesta** `ops_commission_rules`: negocio, profesional, servicio opcional, porcentaje, intervalo de vigencia y autor. Evitar vigencias superpuestas para el mismo ámbito y documentar precedencia servicio > general.
- Conservar `ops_lines.commission_bps`; añadir referencia/versión de regla y base histórica **propuestas**. Evaluar la regla en el momento de negocio confirmado, sin recalcular líneas cerradas al cambiar configuración.
- Mantener distribución proporcional y redondeo existentes. Para reconstruir qué cobro generó qué comisión, añadir asignaciones persistidas de cobro a líneas **propuestas**, con cambios como ajustes, no sobrescritura de eventos pasados.
- Separar indicadores de actividad del período y saldo acumulado. No derivar saldo restando eventos de ventanas distintas. Exportar las mismas consultas filtradas y autorizadas.

### D. Liquidaciones y pagos

- Preservar `ops_settlements` como registro de pagos históricos; no reinterpretar automáticamente esos importes como pagos de servicios específicos.
- Tablas nuevas **propuestas**: `ops_payout_batches` (liquidación y estado administrativo), `ops_payout_items` (comisiones reservadas), `ops_payout_allocations` (importe de un pago asignado a cada comisión), `ops_payout_reversals` (anulación auditable) y `ops_payout_proofs` (archivo privado opcional).
- Extender `ops_settlements` con fecha efectiva, moneda, método, observaciones y liquidación, preservando compatibilidad y fecha de registro. Las reglas de referencia opcional requieren cambiar la validación actual.
- Una comisión puede tener varias asignaciones y pagos parciales dentro de una liquidación; no crear otra reserva activa para el mismo saldo. Usar restricción única apropiada y bloqueo transaccional al reservar, pagar o anular.
- Calcular estado monetario desde pagos/asignaciones válidos menos anulaciones. Nunca permitir marcar pagado sin evento monetario. Preservar pagos confirmados y restaurar saldo mediante anulación trazable.
- Reutilizar Supabase Storage y las validaciones existentes; autorizar descarga por negocio, profesional y permiso. Un archivo opcional no debe bloquear el registro del pago.

### E. Permisos e índices

- Conservar `employee_module_catalog` y permisos configurables. Registrar capacidades nuevas únicamente junto con comprobaciones backend y filtrado de datos; se pueden separar consulta de clientes, atenciones y liquidaciones sin convertir al profesional en agente.
- El Customer 360 completo actualmente exige al menos `viewer`; el profesional no cumple ese rol. Crear una proyección operativa mínima y autorizada de sus clientes. No abrir sus conversaciones o las de otros profesionales por añadir un enlace.
- Administración financiera solo para owner/admin, profesional solo para sus datos permitidos, IA solo para operaciones de agenda autorizadas. Verificar cambios de identificadores y pertenencia en cada consulta, exportación y archivo.
- Índices **propuestos**, ajustados con planes de consulta: citas por `(account_id, professional_id, client_id, starts_at)` y estado; operaciones por negocio/cliente/fecha; líneas por negocio/profesional/operación; comisiones por negocio/profesional/línea/fecha; pagos y asignaciones por liquidación/comisión; reglas por negocio/profesional/servicio/vigencia. Agregar claves únicas de idempotencia y reserva donde corresponda.

## Secuencia de migración y recuperación

1. Migración aditiva de perfil/ciclo de vida y auditoría; luego UI y comandos. No modificar 060/062 ya aplicadas.
2. Migración aditiva de identidad y procedencia; escritura compatible de reservas antiguas/nuevas. Backfill solo de coincidencias demostrables de identidad. Separar ambiguos para revisión, sin unir nombres ni asignar canales inventados.
3. Lecturas de cartera y herramientas IA por canal habilitado, después de comprobar confirmación central e idempotencia.
4. Reglas versionadas y consultas de atenciones. Preservar tasas/valores de líneas y comisiones existentes. No generar comisiones retroactivas.
5. Modelo de liquidaciones y asignaciones. Mantener pagos globales anteriores identificados como legado/no distribuido hasta aprobar una conciliación. No asignarlos ficticiamente a las comisiones más antiguas.
6. Exportación, validación integral y despliegue autorizado aparte. Los números y nombres de los archivos nuevos se asignan al implementar según el último orden de migraciones.

Antes de cada aplicación real: backup y restauración probada en entorno aislado. Habilitar rutas nuevas gradualmente. La recuperación prioriza deshabilitar funciones nuevas y volver a la UI anterior manteniendo tablas aditivas; no revertir borrando pagos o información ya registrada. Cambios de reglas y cobros se corrigen con eventos compensatorios autorizados.

## Decisiones necesarias antes de implementar cada bloque

1. **Comisiones:** confirmar si se conserva la regla existente de cierre/completado más cobro proporcional al neto descontado. Definir tratamiento de impuestos/propinas y fecha de vigencia que selecciona la tasa (reserva, servicio o cierre). Bloquea reglas nuevas, no el perfil básico.
2. **Sin preferencia:** elegir selección explícita o política automática; mientras no exista acuerdo, exigir profesional seleccionado. No sustituirlo sin aceptación. Bloquea asignación automática, no la reserva con profesional elegido.
3. **Pagos:** confirmar FIFO o distribución manual y tratamiento de ajustes negativos tras un pago. Bloquea asignación de pagos, no el reporte del saldo existente.
4. **Identidad social sin teléfono:** confirmar si la reserva admite identidad canónica sin teléfono o debe solicitarlo. Bloquea reserva social sin ese dato.
5. **Semana:** confirmar inicio semanal para reportes y liquidaciones; la zona horaria ya está configurada por negocio.
6. **Varios profesionales en un servicio:** mantener un responsable por línea inicialmente; si se necesita reparto, definirlo antes de habilitar el caso.

No es necesario resolver todas estas decisiones para comenzar la etapa 2. No se da por aprobada ninguna propuesta monetaria del documento adjunto.

## Pruebas y aceptación por bloque

- Perfil: teclado/móvil, URL directa, negocio ajeno, desactivación por llamada directa, revocación limitada al negocio, conservación de historial, citas futuras visibles, eliminación concurrente con alta de dependencia.
- Reservas/cartera: manual y cada canal realmente habilitado, identidad sin duplicación, cliente con varios profesionales, confirmaciones repetidas, solicitudes simultáneas del mismo horario, cancelación/reasignación de primera reserva y alternativa aceptada explícitamente.
- Comisiones: servicios y profesionales múltiples en una operación, descuento, cobros parciales, residuos de centavos, cambio de vigencia, reembolso antes/después de pago, moneda y fecha límite del negocio. Totales completos con más de 500 registros.
- Liquidaciones: pago completo/parcial sin adjunto, distribución a varias comisiones, reserva duplicada, pago concurrente, reintento con la misma clave, anulación motivada, profesional archivado y descarga privada por usuario ajeno.
- Entrega: CSV de todas las filas filtradas con defensa contra fórmulas, permisos por módulo, fechas/semana, comprobantes reales en Storage aislado, integraciones de canal reales y restauración de migraciones sin nueva deuda histórica.

Validación ejecutada en este diagnóstico: **9 archivos y 49 pruebas unitarias aprobadas**, mediante `npm.cmd test -- src/lib/operations src/app/api/operations src/app/api/booking src/lib/customers/identity-resolution.test.ts src/app/api/employee/activate/route.test.ts`. No se ejecutaron fixtures SQL ni integraciones externas nuevas durante este diagnóstico.

## Bloqueos operativos ya observados

- En la última revisión del servidor, Gmail seguía rechazando el SMTP de Supabase con 535 incluso tras recrear los contenedores. Esto bloquea la entrega de invitaciones reales; es independiente de implementar el perfil.
- Hay cambios locales de operaciones y acceso de empleados sin consolidar en Git. Deben revisarse e incorporarse antes de basar un despliegue posterior en el repositorio remoto.
