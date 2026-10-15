# Plantillas por rubro en el onboarding de WACRM

Fecha: 14 de octubre de 2026. Rama: `plantillas`.
Estado: primera entrega implementada en código y validada localmente; activación en Supabase pendiente.

## Objetivo y punto de partida

Cada negocio elige su rubro y objetivo, revisa una configuración sugerida y puede aceptarla, adaptarla o comenzar desde cero. WACRM mantiene un núcleo agnóstico: el rubro no obliga a usar una estructura ni concede funciones pagadas.

El repositorio ya incluye contactos, campos personalizados de contacto, pipelines y etapas. El nuevo alta desde el selector tiene tres pasos (datos, plan solicitado y confirmación), una API y la migración 057 preparada. Las migraciones 056 y 057 todavía no se han aplicado en la base Supabase conectada; el alta real desde la interfaz está pendiente de acceso SQL. El rubro actual se registra como texto y no configura módulos.

Este trabajo amplía las fases 2 y 7 del plan OaaS general. La automatización de la fase 5 de este documento depende de la integración fiable CRM–n8n del plan general; el reporting publicitario depende además de fuentes de gasto y ventas verificables.

## Seis fases de entrega

| Fase                           | Entrega                                                                                                                                  | Criterio para darla por terminada                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Catálogo y modelo           | Separar rubro, objetivo, plantilla, versión y plan. Definir una plantilla genérica y una inmobiliaria inicial.                           | Cada plantilla declara sus etapas, campos compatibles, objetivos y capacidades requeridas; se puede elegir «desde cero».              |
| 2. Configuración inicial       | Implementar el mecanismo que crea pipelines, etapas y campos propios del nuevo negocio, usando los recursos actuales del CRM.            | La configuración se aplica sin duplicados ni datos de otros negocios; un fallo no deja un negocio configurado a medias.               |
| 3. Onboarding guiado           | Incorporar rubro, objetivo, vista previa y selección de plantilla al alta desde el selector.                                             | Playwright crea un negocio desde el mismo login, muestra su configuración y verifica el cambio de contexto.                           |
| 4. Personalización y evolución | Permitir editar la configuración y evaluar cambios de plantilla con vista previa de diferencias.                                         | Los contactos, oportunidades y ajustes existentes se conservan; etapas con datos requieren mapeo explícito antes de migrar.           |
| 5. Automatización y resultados | Añadir recetas gestionadas, objetivos medibles y controles por suscripción del negocio.                                                  | Una receta autorizada se ejecuta con registros verificables; una capacidad sin contratar permanece bloqueada en el servidor.          |
| 6. Módulos por rubro y piloto  | Desarrollar los módulos que exceden la configuración del CRM, comenzar con inventario inmobiliario y ampliar el catálogo tras el piloto. | Dos negocios de rubros distintos funcionan con el mismo login, mantienen aislamiento y completan sus recorridos con evidencia visual. |

Las fases 1–3 tienen su primera implementación: catálogo General/Inmobiliaria/Desde cero, configuración transaccional por negocio y onboarding de cinco pasos con ajuste de etapas. Se registra objetivo y versión; `/plan` muestra la configuración aplicada cuando existe. Las pruebas locales de SQL verifican creación, reintentos, rollback y aislamiento. Playwright verificó las pantallas, sugerencia inmobiliaria, objetivo alquiler, edición de etapas y opción vacía; el alta en la base conectada respondió `migration_required`, sin crear una cuenta. Falta validar la cadena completa de migraciones en staging y aplicar 056–058 para completar el criterio de alta real de fase 3.

La fase 4 está parcialmente cubierta por ajustes antes del alta y por los editores actuales de pipelines/campos; comparación y cambio de plantilla de un negocio existente siguen pendientes. Fases 5 y 6 pendientes de sus módulos e integraciones. Inventario de propiedades, editor de workflows, cobros y reporting publicitario completo no forman parte de esta primera entrega.

## Fase 1: catálogo y modelo

- Separar el rubro del objetivo: una inmobiliaria puede priorizar venta, alquiler o captación de propietarios.
- Definir identificador estable, versión, descripción, objetivos disponibles, etapas y campos de cada plantilla.
- Clasificar cada componente como disponible, sujeto a plan o pendiente de implementación. La vista previa solo ofrece componentes que el sistema puede aplicar.
- Mantener la selección del plan independiente de la plantilla. Una solicitud de mejora de plan no equivale a una suscripción activa.
- Registrar la elección y versión por `account_id`, junto con el usuario y fecha de aplicación. No almacenar secretos en las plantillas.

Resultado: catálogo validado de plantilla genérica e inmobiliaria y contrato de configuración sin dependencia de n8n.

## Fase 2: configuración inicial

- Reutilizar pipelines, etapas y campos personalizados de contacto donde sean compatibles. No presentar campos de contacto como un inventario de propiedades.
- Aplicar la configuración y registrar su versión de manera transaccional. Un reintento con la misma solicitud no crea otra cuenta ni duplica etapas.
- Obtener el propietario de la sesión y comprobar membresías y permisos en el servidor.
- Crear recursos vacíos por negocio. No copiar contactos, conexiones publicitarias, WhatsApp, credenciales, suscripciones ni workflows de otro negocio.
- Validar la cadena de migraciones en staging antes del alta real; resolver el acceso SQL para las migraciones pendientes.

Resultado: un nuevo negocio recibe exclusivamente su configuración elegida; las funciones pagadas permanecen bajo la política de suscripción.

## Fase 3: onboarding guiado

Recorrido propuesto desde «Crear negocio»:

1. Nombre, rubro y moneda.
2. Objetivo principal del negocio.
3. Plantilla sugerida con vista previa de etapas, campos y componentes disponibles. Opciones de aceptar, ajustar o comenzar desde cero.
4. Plan y capacidades: distinguir acceso incluido, solicitudes de contratación y módulos futuros. No mostrar precios inventados ni cobrar sin checkout implementado.
5. Confirmación, creación y apertura del negocio. Mostrar tareas posteriores de conexión dentro de ese negocio.

Para negocios existentes, ofrecer un acceso separado desde configuración; no volver a ejecutar el alta ni aplicar una plantilla por cambiar el texto del rubro.

Resultado: prueba Playwright del recorrido completo, reintento tras fallo, navegación entre negocios y uso en móvil. Si falla la aplicación transaccional, mostrar el error y conservar el formulario para reintentar.

## Fase 4: personalización y evolución

- Permitir cambiar nombres, agregar etapas y editar los campos compatibles con permisos de administrador o propietario.
- Conservar la versión de origen y los cambios propios del negocio. Una nueva versión del catálogo no modifica negocios existentes automáticamente.
- Antes de aplicar otra plantilla, mostrar qué se agrega, conserva, archiva o necesita mapeo. El cambio de rubro por sí solo no ejecuta una migración.
- No eliminar etapas o campos con referencias sin una decisión explícita y un plan de conservación de datos.
- Auditar cambios y permitir revertir configuración cuando no existan referencias que impidan hacerlo; en los demás casos, restaurar mediante un mapeo revisado.

Resultado: personalización segura con una prueba sobre un negocio que ya contiene oportunidades y ajustes propios.

## Fase 5: automatización y resultados

- Añadir recetas optativas: asignación de consultas, recordatorio de visita y seguimiento de interesados. Comienzan desactivadas hasta completar conexiones y autorización.
- Mantener las recetas separadas del motor: WACRM define la intención y n8n ejecuta mediante la integración controlada, cuando esté disponible.
- Comprobar capacidades, cuotas y conexiones del negocio en el servidor. Cambiar de negocio no transfiere beneficios del plan anterior.
- Definir métricas con reglas claras: consultas, oportunidades calificadas, visitas realizadas y cierres; distinguir ingreso de la operación y comisión del negocio.
- Incorporar gasto y atribución publicitaria solo con conexiones propias y ventas conciliadas. Una venta atribuida a un anuncio no prueba por sí sola una mejora causada por WACRM.

Resultado: una receta gestionada comprobada en un negocio elegible y bloqueada en otro sin acceso; resultados trazables a eventos reales. El editor para clientes queda condicionado a la licencia comercial y a su implementación.

## Fase 6: módulos por rubro y piloto

- Primer módulo específico propuesto: inventario inmobiliario con propiedades, disponibilidad y relación con oportunidades. Su alcance y permisos requieren diseño independiente.
- Después del piloto, evaluar plantillas para servicios, comercio y educación basándose en sus procesos reales. Priorizar configuración reutilizable antes de desarrollar módulos adicionales.
- Probar el mismo usuario con una inmobiliaria y otro negocio de distinto rubro: configuración, datos, roles, conexiones y capacidades propios.
- Liberar por etapas en staging y después por grupo piloto. Mantener recuperación y observabilidad durante el despliegue.

Resultado: evidencia funcional del recorrido por rubro y catálogo que puede ampliarse sin imponer un sector al resto del producto.

## Ejemplo de la primera plantilla inmobiliaria

| Elemento                  | Configuración sugerida                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| Objetivo                  | Venta, alquiler o captación de propietarios, elegido por el usuario              |
| Pipeline de venta         | Consulta → calificación → visita → oferta → negociación → cierre                 |
| Campos de contacto        | Tipo de interesado, zona de interés y presupuesto, según los tipos ya soportados |
| Resultado                 | Cierre registrado, con métricas intermedias de oportunidades y visitas           |
| Inventario de propiedades | Módulo propuesto para fase 6; no se simula con la plantilla inicial              |
| Automatización            | Recetas optativas de fase 5, sujetas a conexiones y plan                         |

## Orden y validación

Completar fases 1 → 2 → 3 para el primer piloto. Continuar con personalización, automatización y módulos específicos según sus dependencias. No se fija una fecha de despliegue hasta validar el entorno conectado y el alcance de la primera plantilla.

Las comprobaciones de aceptación cubrirán aislamiento por negocio, permisos, aplicación atómica, reintentos, conservación de datos y bloqueo de funciones no contratadas. Las capturas Playwright deberán distinguir funcionalidad operativa de pantallas pendientes de activación.

# Actualización operativa

La habilitación de módulos se basa ahora en actividad principal y actividades adicionales, elegidas mediante select y controles adicionales. Consulte [el plan de ocho fases](PLAN_ACTIVIDADES_OPERACION_FINANZAS.md) para implementación, pruebas y activación pendiente. Las plantillas conservan su función de configuración inicial de etapas y objetivo.
