# Acceso administrado de empleados

En Operations, administración crea el profesional y activa «Permitir acceso al sistema». El perfil y sus permisos se guardan en una sola transacción. La creación de la identidad de Supabase y el envío ocurren después: un fallo de correo conserva el perfil y permite reenviar desde su tarjeta.

El empleado abre el correo, elige una contraseña y activa su acceso. Entra en Operations con el negocio de la invitación seleccionado. Un usuario existente conserva sus otros negocios y roles. No se cambian sus credenciales ni su perfil al vincularlo a un negocio adicional.

## Permisos editables

«Acceso y permisos» permite conceder o retirar módulos posteriormente. «Suspender acceso» cancela también el enlace pendiente; para reactivar se genera una invitación nueva. No se eliminan el usuario global, citas, operaciones o comisiones históricas.

| Módulo | Alcance |
| --- | --- |
| Mi agenda | Citas propias; iniciar atención, cancelar o marcar ausencia |
| Mis operaciones | Operaciones propias y cierre de atención/venta |
| Mis comisiones | Comisiones y liquidaciones propias |
| Comprobantes | Adjuntar y consultar los propios; sin confirmar cobros |
| Catálogo | Servicios asignados y productos; sin costos ni edición |

El cierre de una cita registra su operación y requiere **Mis operaciones**. La lectura de datos y las acciones se comprueban en SQL; el menú no es el control de acceso. Las tablas de invitaciones son privadas. Las implementaciones `ops_command_core` y `ops_dashboard_core` no son ejecutables por clientes autenticados.

Los profesionales vinculados antes de la migración 062 conservan los cinco permisos operativos que ya tenían. Nuevos empleados reciben por defecto agenda, operaciones y comisiones; administración puede elegir otro conjunto, incluso ninguno.

## Añadir otro módulo

`employee_module_catalog` es el registro de módulos concedibles. Para incorporar uno:

1. Implementar su alcance de datos y acciones en servidor, incluyendo acceso por negocio y por empleado. Mantener denegación por defecto.
2. Usar `ops_employee_can(account_id, module_id)` donde se autorizan esas acciones. Extender el filtrado del dashboard o el endpoint específico para no entregar datos deshabilitados.
3. Incorporar su vista y navegación para profesionales. Un módulo fuera de Operations también requiere ampliar explícitamente la protección de rutas/RLS del CRM; no debe elevarse al empleado a `agent` o `admin`.
4. Añadir el registro disponible al catálogo mediante migración, con nombre y descripción. El formulario administrativo lo descubre automáticamente y permite concederlo o retirarlo a cada empleado.
5. Probar consulta directa de API/RPC, revocación con sesión existente y aislamiento de otros empleados/negocios.

No se deben registrar como disponibles módulos que aún no tienen esa integración.

## Aprovisionamiento y despliegue

Aplicar 061 y 062 después de 056–060 y desplegar el código correspondiente. La aplicación necesita `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y una clave `ENCRYPTION_KEY` estable. Supabase Auth debe tener SMTP operativo y aceptar la redirección `/employee/activate?token=…` del dominio público.

La versión instalada de Auth inserta al usuario antes de actualizar metadatos e `invited_at`. Por eso el servidor crea la identidad con un UUID reservado en la tabla privada de acceso; el trigger lo reconoce antes de crear el perfil. El registro público no puede seleccionar ese UUID. La pertenencia operativa queda inactiva hasta verificar el correo y aceptar el enlace.

Los tokens se derivan con HMAC y solo se guardan como SHA-256. La derivación usa cuenta, profesional y solicitud, lo que permite reintentar un envío sin almacenar el enlace en texto. Rotar la clave requiere reenviar invitaciones pendientes. Un enlace de la aplicación dura siete días; el enlace de Auth puede vencer antes según su configuración, y se puede reenviar desde la tarjeta del profesional.

La contraseña la elige el empleado. Una marca de metadatos recuerda que ya la eligió, exclusivamente para la interfaz; no concede roles ni permisos.

## Validación

Los fixtures `activity-operations.sql`, `operations-edges.sql` y `employee-access.sql` deben ejecutarse solo en una base nueva y aislada. Cubren creación sin negocio personal, verificación de correo, rollback del alta, denegación de módulos, bloqueo de implementaciones internas, suspensión inmediata y conservación de otras membresías. Las pruebas de API cubren envío fallido, usuarios existentes, almacenamiento privado y cookies de activación.
