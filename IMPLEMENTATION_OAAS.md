# Implementación WACRM OaaS

Rama actual: `plantillas`, creada desde `codex/oaas-community-foundation`. Fecha inicial: 14 de octubre de 2026.

## Fases desplegables

| Fase | Entrega                                                      | Estado                                             |
| ---- | ------------------------------------------------------------ | -------------------------------------------------- |
| 1    | Preparación: inventario, alcance, contratos y entornos       | Plan/repo revisados; entorno real pendiente        |
| 2    | Base por negocio: planes, capacidades, procesos y resultados | En curso: primer incremento de planes implementado |
| 3    | Ejecución fiable: outbox, n8n, API de acciones y controles   | n8n local iniciado; integración pendiente          |
| 4    | Seguimiento y recuperación con evidencia                     | Pendiente                                          |
| 5    | Asistente con acciones autorizadas                           | Pendiente                                          |
| 6    | Piloto OaaS: publicidad, costos, suscripciones y operación   | Pendiente                                          |
| 7    | Autoservicio, consola resiliente y escala                    | Pendiente; editor sujeto a contrato de licencia    |

No se está desplegando todo el plan en esta entrega. El primer incremento permite consultar capacidades por negocio y preparar n8n localmente; no ejecuta cobros ni suspensiones globales.

## Primer incremento

- Migración `056_account_subscriptions.sql`: una suscripción por negocio, RLS de lectura para miembros y escrituras solo del operador mediante rol de servicio. Alta CRM para negocios existentes y nuevos, sin conceder funciones avanzadas.
- Catálogo `crm`, `managed`, `advanced`; el editor de clientes requiere además `workflow_editor_licensed`, concedido solo tras revisar el contrato aplicable.
- Política para trial, gracia, suspensión, cancelación y expiración. El guard `requirePlanFeature` se usará en los nuevos endpoints/workers; los módulos antiguos todavía no se han migrado a esta política.
- `GET /api/account/plan`: usa la cuenta autenticada, sin parámetros para leer otro negocio y sin caché compartida.
- Página `/plan`, enlazada en sidebar, con capacidades y estado del negocio activo. No presenta integraciones futuras como operativas.
- Compose Community/PostgreSQL local en `infra/n8n`, con volúmenes, secretos por archivo, health checks y puerto loopback.

El plan `advanced` es una definición de capacidades para desarrollo. No ofrece todavía checkout, reportes publicitarios o un editor funcional. La asignación de un plan no ejecuta un cargo. Precios y cuotas se definirán comercialmente.

## Aplicación y verificación

1. Revisar/aplicar 056 en un entorno Supabase de pruebas con las migraciones previas. Este trabajo no la aplica automáticamente a producción.
2. Abrir `/plan` con sesión válida. Sin 056, se muestra configuración pendiente y no se conceden nuevas capacidades.
3. Validar dos negocios con planes distintos, lectura RLS y rechazo de escritura de suscripciones por usuarios autenticados. Completar prueba SQL contra base aislada antes de desplegar.
4. Seguir `infra/n8n/README.md` para levantar el piloto local y verificar salud. Esto no conecta aún eventos reales.
5. Implementar outbox transaccional y acciones por conversación en fase 3, conservando el motor anterior y sus esperas.

Verificaciones iniciales: 34 pruebas de planes, almacenamiento, API, membresías y cambio de cuenta pasaron; `npm run typecheck` y `npm run build` pasaron. ESLint de los archivos modificados: sin errores, dos warnings de imports previamente no utilizados en header. Docker Compose validó configuración. La migración se ejecutó en PostgreSQL local aislado: lectura por negocio, rechazo de escritura de miembros/anon, actualización por service role, restricción de gracia y alta de nueva suscripción pasaron. El fixture reemplaza los requisitos Supabase previos con funciones mínimas; no sustituye validación de la cadena completa de migraciones en staging.

El sandbox Windows requiere que TEMP/TMP apunten a una carpeta writable para el cache de Vitest. No se aplicó 056 en Supabase ni se cambió el motor existente. Los archivos de secretos locales no se versionan. La base de prueba se llama `wacrm_subscription_test` y no se usa como base de n8n.

n8n Community 2.43.5 y PostgreSQL están iniciados localmente mediante el Compose del piloto. `/healthz/readiness` devolvió HTTP 200. URL del operador: `http://localhost:5678`; falta completar el alta del propietario en la interfaz. El modo de runners externo exige su secreto aunque no haya runners: se agregó el archivo de token, y los nodos Code permanecen excluidos. No hay workflows ni integración CRM ejecutándose. El panel administrativo independiente aún no está construido.

## Próxima entrega

Subplan de plantillas por rubro: [PLAN_PLANTILLAS_ONBOARDING.md](PLAN_PLANTILLAS_ONBOARDING.md). Primera entrega implementada en la rama `plantillas`: catálogo, configuración transaccional, objetivo/versionado y onboarding guiado con ajuste de etapas. Requiere migración 058 además de los prerrequisitos. Amplía las fases 2 y 7 de OaaS; la activación en la base conectada sigue pendiente de acceso SQL.

Alta desde selector implementada en código: opción «Crear negocio», diálogo de tres pasos (datos, plan solicitado, confirmación) y `POST /api/account/businesses`. Migración 057 crea la transacción `create_business`, permite varios negocios por propietario, conserva el perfil antiguo y sus membresías, asigna propietario autenticado, limita a 25 negocios y evita duplicación por reintentos. El plan elegido se guarda como solicitud: no concede acceso pagado, cargos ni licencia de editor. La creación tampoco copia conexiones o datos de otros negocios. Requiere migración 029 y moneda de 021; aplicar 056 para suscripciones base. La migración 057 NO se ha aplicado a Supabase conectado: no hay acceso SQL configurado. Playwright recorrió el selector y onboarding de «Academia Horizonte» en localhost:3101 y confirmó respuesta 503 `migration_required`; no creó ese negocio remoto. Capturas 16–20, `work/evidence/create-business-report.json`. Ocho pruebas de API y fixture SQL aislado de atomicidad, propietario, aislamiento y reintentos pasaron. No confundir las capturas de alta con una cuenta activada.

Evidencia multi cuenta: el entorno tenía `NEXT_PUBLIC_WACRM_ENABLE_MULTI_ACCOUNT_SWITCH=false`. Se recompiló y arrancó solo la instancia local con ambos flags de cambio de cuenta en `true`. Playwright verificó un mismo login con membresía owner en negocio A y admin en negocio B, cambio A→B→A desde el menú de usuario del sidebar y coincidencia del negocio activo con `/api/account/plan`. Capturas 13–15 y `work/evidence/multi-account-report.json`. Esto valida selección por membresías; no implementa todavía alta autoservicio, checkout ni planes activos. La configuración de producción no se modificó. El propietario local de n8n ya completó su alta; sigue sin workflows CRM.

Modelo de proceso/resultado, alta independiente con elección de plan, transporte persistente CRM → n8n y reconciliación. Posteriormente, suscripciones/cobros, gasto publicitario y consola separada con autenticación/almacén de control independientes.
