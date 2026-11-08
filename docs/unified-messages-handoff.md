# Nebula — Mensajería unificada, solicitudes y propuestas

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

Entrega local para Manuel. Implementa el handoff de mensajería sobre SQLite, sesiones y archivos existentes. No conecta servicios externos.

## Experiencia entregada

Messages es la bandeja Artist común, accesible desde la sidebar y la barra móvil. Conversations contiene solicitudes aceptadas y conversaciones históricas. Requests muestra recibidas/enviadas y permite consultar separadamente las rechazadas/retiradas con **Closed requests**. Cada fila identifica contraparte, contexto, estado de admisión, estado de trabajo, actividad y contador privado. La consulta pagina antes de devolver resultados (30 por página), sin descargar los transcripts.

Desde el perfil público, **Message** prepara una solicitud general; para visitantes conduce al acceso existente y para Investor/propietario no se ofrece auto-contacto. Un proyecto también permite enviar un mensaje con su contexto visible, sin fabricar una oferta. Una conversación general existente se identifica explícitamente, con su contexto, antes de abrirla.

**Contact artist** y **Submit proposal** abren el mismo compositor de oportunidad, sin crear registros ni emitir avisos. Se envían conjuntamente introducción, propuesta completa, archivos y revisión de términos. El propietario puede consultar el perfil, leer la propuesta y descargar los archivos antes de decidir.

Una aceptación habilita mensajes en el mismo hilo y conserva introducción, propuesta y archivos. La solicitud general acepta conversar; la formal acepta una propuesta concreta y sus términos mediante las reglas anteriores de trabajo. No se añade otra aceptación de contacto. Las solicitudes rechazadas conservan la respuesta opcional y el historial, sin chat libre ni reapertura. Una revisión formal previa a la aceptación sigue siendo una acción estructurada, con posibilidad de volver a presentar trabajo en el mismo hilo.

## Fuentes canónicas y extensión compatible

| Registro | Responsabilidad |
|---|---|
| `collaborations` y `collaboration_messages` | Hilo formal y su único transcript, reutilizados. Nuevas columnas `request_policy`, `admission` y `kind` en mensajes. |
| `collaboration_offers`, `collaboration_submissions`, `collaboration_files` | Oferta, términos, revisiones, entrega y asociaciones privadas existentes. No se copian archivos. |
| `artist_conversations` | Solicitud general, participantes, contexto opcional, admisión y revisión. `UNIQUE(pair_a,pair_b)` sobre la pareja ordenada. |
| `artist_messages` | Único transcript general: introducción, decisión estructurada y mensajes autorizados. |
| `conversation_activity` | Índice de eventos por tipo/hilo/actor/fecha. No replica textos ni archivos. |
| `conversation_reads` | Watermark privado por tipo de hilo, hilo y participante. |
| `message_operations` | Clave de operación, actor, ámbito, huella del payload y resultado mínimo, persistidos. |
| `artist_notifications` | Historial existente ampliado con destino `conversation`; se conservan colaboración y Follow. |

La identidad de un hilo es `(kind, id)`. Nunca se intercambian IDs entre los tipos. Un artista puede tener diferentes trabajos con la misma contraparte y una solicitud general: no se fusionan condiciones ni se generan copias automáticas al aceptar. La unicidad formal sigue siendo `(offer, applicant)`.

### Admisión y trabajo

- General: `pending → accepted` o `pending → rejected`. Solo el destinatario decide; la revisión debe coincidir.
- Formal nuevo: empieza `status=submitted`, `admission=pending`, `request_policy=1` con una propuesta completa. Solicitar cambios mantiene pendiente la admisión. Aceptar requiere la última propuesta identificada por `submissionId`, la revisión del hilo y la revisión vigente de la oferta/términos. Abre chat y conserva el mismo ID.
- Rechazar o retirar una solicitud formal nueva cierra su admisión. La selección de un colaborador mantiene el cierre de oferta y rechazo de competidores pendiente que ya existía.
- Después de aceptar, entrega, revisión de entrega y finalización modifican el estado de trabajo; la admisión permanece aceptada.
- No se ejecutan cobros, acuerdos externos ni distribución de regalías.

### Política histórica y migración

Los hilos existentes reciben `request_policy=0` y `admission=accepted` mediante valores por defecto estables. Sus estados de trabajo, textos, autores, fechas y términos permanecen intactos. Incluso un hilo histórico rechazado/retirado conserva la comunicación que ya permitía. No se decide la compatibilidad por fechas, contenido o nombres.

La adición de columnas de colaboración se ejecuta transaccionalmente. No se reescriben propuestas ni archivos. Los mensajes anteriores reciben `kind=message` sin alterar su contenido.

La tabla de notificaciones se reconstruye transaccionalmente para permitir el tercer destino. Conserva columnas anteriores, IDs, lectura, fechas, índices, triggers y el máximo autoincremental, también después de IDs borrados. Es compatible tanto con la tabla original como con la versión que ya incluye Follow y su `occurrence_key`. No reemite avisos. Un destino general ausente o ajeno devuelve historial sin enlace operativo.

No se hace backfill del nuevo índice de actividad para mensajes históricos: su transcript sigue completo, pero sus contadores de conversación comienzan con actividad posterior a esta entrega. Los contadores históricos de notificaciones no se reinician.

## Rutas de interfaz

| Ruta | Función |
|---|---|
| `/messages` | Bandeja unificada. |
| `/messages/new/:artistId?project=:projectId` | Composición general sin efectos hasta enviar. |
| `/messages/offer/:offerId` | Composición formal; admite los parámetros existentes `draft` y `publication` para trabajo de Remix. |
| `/messages/general/:id` | Solicitud/chat general. |
| `/messages/collaboration/:id` | Hilo formal con propuesta, entrega y transcript común. |
| `/collaborations` | Alias de entrada que resuelve a Messages. |
| `/collaborations/:id` | Alias del mismo componente e ID formal. Conserva enlaces y avisos antiguos. |

Las pestañas, filtros de bandeja, desplazamiento y borradores se conservan por artista. No se eliminan destinos de navegación para añadir Messages. Los controles y estilos reutilizan el sistema Nebula; la barra móvil mantiene safe areas.

## Contrato HTTP

La sesión determina el actor. Los endpoints requieren Artist; no existe una API genérica de creación de notificaciones.

| Endpoint | Contrato |
|---|---|
| `GET /api/messages` | `view=conversations\|requests`, `direction=received\|sent`, `closed=0\|1`, `cursor` opcional ligado a usuario/vista. Devuelve `items,nextCursor`. |
| `GET /api/messages/compose?artist=ID&project=ID` | Destinatario público real, contexto visible de su propiedad y referencia a la conversación general existente, si la hay. Sin escrituras. |
| `POST /api/messages/requests` | `operationId,recipientId,text,projectId?`. Crea introducción + solicitud + actividad + aviso, o devuelve el hilo existente de la pareja sin reenviar ni reabrirlo. |
| `GET /api/messages/general/:id?before=ID` | Detalle autorizado y 50 mensajes, con cursor para anteriores. |
| `PATCH /api/messages/general/:id` | `operationId,action=accept\|reject,revision,response?`. Decisión del destinatario sobre pendiente. |
| `POST /api/messages/general/:id/messages` | `operationId,text`. Solo admisión aceptada. |
| `PATCH /api/messages/:kind/:id/read` | `throughId` de actividad existente dentro de ese hilo; actor participante. Nunca una marca temporal futura. |
| `GET /api/offers/:id/conversations` | Composición formal sin efectos: `offer,existing`. |
| `POST /api/offers/:id/conversations` | Nuevo contrato: `operationId,introduction,text,offerRevision,acceptTerms,mediaId/mediaIds,publicationId?,remixDraftId?`. Requiere propuesta válida y oferta vigente. Ya no crea hilos vacíos. |
| `GET/PATCH /api/collaborations/:id` | Conserva revisiones/entregas/trabajo. Las mutaciones nuevas incluyen `operationId`; aceptar formal nuevo añade `submissionId,offerRevision`; rechazar admite `response`. |
| `POST /api/collaborations/:id/messages` | Aplica admisión también en la ruta antigua. La UI utiliza `operationId` para todos los hilos; clientes históricos sin clave siguen permitidos exclusivamente sobre hilos históricos. |

No se aceptan propietarios, estados de admisión o revisiones inventadas como fuente de autorización. Se verifica oferta/proyecto, propiedad de archivos, términos y participación. Un Follow, género o rol creativo no concede acceso. Los remixes continúan compartiendo exclusivamente el resultado final autorizado mediante propuesta; no se expone el borrador editable.

## Atomicidad e idempotencia

Las operaciones de envío, aceptación, rechazo/respuesta y mensaje guardan conjuntamente sus cambios y notificaciones en una transacción SQLite síncrona `BEGIN IMMEDIATE`, sin transacciones anidadas. Un fallo de aviso revierte los mensajes y decisiones asociados.

`message_operations` tiene clave primaria `(actor,operation)`. Una clave repetida solo se reutiliza cuando coincide el ámbito y la huella canónica del payload; otra acción o contenido produce 409. El resultado mínimo permite reintentar después de perder la respuesta o reiniciar. Dos mensajes legítimos con idéntico texto y distintas claves se conservan como mensajes distintos. La UI conserva claves pendientes en sus borradores por pestaña y artista y las retira tras éxito.

La unicidad de pareja y oferta/solicitante sigue protegiendo solicitudes incluso con claves distintas. No se reabren solicitudes rechazadas por reintento. Aceptar y rechazar simultáneamente producen una única transición válida, con 409 para la operación que perdió la revisión.

## Avisos y lectura privada

Generales: `conversation.requested`, `conversation.accepted`, `conversation.rejected`, `conversation.message`, con destino tipado `conversation` y `conversationId`, sin `collaborationId` ficticio. Sus enlaces se construyen desde IDs verificados.

La solicitud formal inicial produce un solo aviso `submit`, no una combinación duplicada de `contact`, `message` y `submit`. Las revisiones, entregas y demás avisos de trabajo continúan. Los avisos históricos `contact` y todos los Follow siguen disponibles.

Leer un aviso no modifica el watermark de conversación. **Mark viewed activity as read** permite confirmar explícitamente la actividad cargada en el hilo hasta su `lastActivityId`; el servidor valida que el límite pertenezca al hilo y conserva el máximo privado. Una llegada posterior permanece sin leer. No se marca automáticamente al abrir una ruta, ni se publican Seen/presencia.

Bandejas y detalles reutilizan polling de 10 segundos y refresco al recuperar foco. La protección por identidad, cancelación de consultas, aborto de mutaciones desmontadas y limpieza de borradores/cachés evitan que respuestas tardías vuelvan a mostrar información de la cuenta anterior. La entrega no promete instantaneidad.

## Recepción futura y límites

`mayReceiveRequest` en `server/message-storage.ts` es el punto de integración para futuros ajustes de recepción. Actualmente admite solicitudes generales y oportunidades válidas para Artist. La recepción, la aceptación y la emisión de avisos son decisiones separadas.

No hay mensajería Investor, grupos, adjuntos libres de chat, edición/borrado/reacciones, presencia, llamadas, reapertura, bloqueo/reporte, settings, push ni envío interno de publicaciones. Se conservan los límites existentes de frecuencia (60 mutaciones de colaboración/mensajería por minuto y artista) y formatos/tamaños de trabajo. Los registros de idempotencia no tienen purga automática en esta entrega local.

Antes de abrir el sistema al público se requiere definir prevención de abuso/moderación, bloqueo/reporte, cuotas/retención, protección operativa de medios y contratos externos. Esta entrega no certifica producción y no conecta Antiq central, SSO, almacenamiento cloud ni pagos.

## Verificación y activación

Las pruebas ejecutadas y la comparación de preservación se detallan al final de este documento. Las pruebas usan bases SQLite, cuentas y archivos temporales independientes del servidor del usuario. El build candidato se genera en `.data/unified-messages-final/public` y no sustituye el frontend activo hasta terminar la verificación.

## Inventario de esta entrega

Comparación contra el respaldo tomado al iniciar esta tarea; los demás cambios locales anteriores se preservan.

### Código y contratos

- `artifacts/nebula/src/App.tsx`
- `artifacts/nebula/src/components/shell/navigation.tsx`
- `artifacts/nebula/src/context/AuthContext.tsx`
- `artifacts/nebula/src/features/collaborations/index.tsx`
- `artifacts/nebula/src/features/notifications/index.tsx`
- `artifacts/nebula/src/pages/artist.tsx`
- `artifacts/nebula/src/pages/project.tsx`
- `lib/local/src/collaborations.ts`
- `lib/local/src/index.ts`
- `lib/local/src/notifications.ts`
- `server/app.ts`
- `server/collaborations.ts`
- `server/notifications.ts`
- `artifacts/nebula/src/features/messages/index.tsx`
- `artifacts/nebula/src/features/messages/shared.tsx`
- `lib/local/src/messages.ts`
- `server/message-storage.ts`
- `server/messages.ts`

### Verificación y documentación

- `lib/local/src/notifications.test.ts`
- `scripts/test-server.mjs`
- `server/app.test.mjs`
- `server/notifications.test.mjs`
- `tests-collaborations/interface.spec.ts`
- `tests-collaborations/notifications.spec.ts`
- `tests-collaborations/workflow.spec.ts`
- `tests-remix/remix.spec.ts`
- `tests-shared/navigation.spec.ts`
- `docs/unified-messages-handoff.md`
- `server/messages.test.mjs`
- `server/message-migration.test.mjs`
- `server/test-fixtures.mjs`
- `tests-collaborations/legacy-fixture.ts`
- `tests-collaborations/messages.spec.ts`

Las regresiones de conversación histórica se preparan insertando fixtures en SQLite temporal mediante helpers exclusivos de prueba. No se añadió ningún endpoint de bypass. Las pruebas de solicitud nueva usan el contrato real, con propuesta completa y admisión pendiente.

## Resultados finales

| Comprobación | Resultado |
|---|---|
| Vitest (`pnpm test`) | 67/67, 11 archivos. |
| API, almacenamiento y migraciones (`node --test server/*.test.mjs`) | 52/52. |
| Navegador | 140 casos distintos aprobados entre escritorio y móvil emulado en Chrome. |
| TypeScript (`pnpm typecheck`, `pnpm build:server`) | Sin errores. |
| Producción Vite | Build nuevo generado; continúa el aviso de bundle JavaScript superior a 500 kB. |
| Recorridos finales de mensajería | 3 casos por tamaño sobre el build final: revisión/cambio de términos/aceptación/entrega, rechazo y aislamiento, reintento de mensaje y logout con respuesta pendiente. |

Los 140 casos incluyen 12 de interfaz/trabajo históricos, 6 de solicitudes y mensajes nuevos, 18 de notificaciones/Follow, 16 de perfiles/onboarding/sesiones, 18 de búsquedas y géneros, 24 de Home/Following/navegación, 20 de publicaciones/interacciones/Investor/retorno, 10 de Remix y 16 de persistencia/historial en modo navegador. Se realizaron comprobaciones visuales de las capturas de escritorio y móvil. La emulación móvil no equivale a una certificación en dispositivos físicos o Safari.

Las pruebas comprueban tres contextos independientes para propuesta y acceso indebido; rollback inducido de solicitud, aceptación, rechazo y mensajes; claves reutilizadas con payload distinto; aceptación/rechazo concurrentes; paginación; lectura privada acotada; reintentos tras respuesta perdida y reinicio; solicitudes cerradas/vencidas; rechazo de competidores; acceso mediante rutas antiguas; conservación del flujo histórico; archivos múltiples y remixes privados con atribución; cambios de cuenta; y los problemas anteriores de identidad tras logout y edición concurrente de perfiles.

Se ajustaron los fixtures históricos y los selectores de navegación al nuevo flujo. No se habilitó creación de hilos vacíos para satisfacer pruebas anteriores. Las regresiones generales se ejecutaron en el candidato aislado; la comprobación final de mensajería y la persistencia en navegador se ejecutaron sobre el build exacto activado.

### Activación y preservación comprobada

- URL: `http://127.0.0.1:4174/messages`. Frontend activado: `/assets/index-DDorIftN.js`; contenido servido verificado contra el artefacto final.
- Backup previo a la activación: `/Users/luisgramz/Documents/ChatGPT/ANTIQ NEBULA2/nebula_v1/.data/backups/before-unified-messages-activation-20261108T031439Z`. Incluye SQLite, medios y builds anterior/candidato.
- Las 19 tablas originales coinciden exactamente en todas sus columnas anteriores, incluidas secuencias e historial. La integridad SQLite devuelve `ok`.
- Conservados: 3 cuentas, 3 perfiles Artist, 7 proyectos, 4 publicaciones, 1 relación Follow y 5 archivos originales. Los hashes de todos los medios coinciden. No se usaron cuentas o archivos reales como fixtures.
- La activación añade únicamente las estructuras/columnas compatibles de esta entrega; no genera solicitudes, mensajes ni avisos sobre los datos reales.
- Acceso anónimo a `/api/messages` y `/api/notifications` comprobado: 401.
- Evidencia local: `../auditoria/unified-messages-2026-11-07/activation-preservation.json`, `live-check.json`, `changed-files.json`, `browser-cases.json` y `verification/`.

No quedan fallos funcionales abiertos en las verificaciones ejecutadas. Se mantienen los límites de esta entrega local: lectura privada con confirmación explícita, polling de 10 segundos, contadores históricos de conversación sin backfill, sin adjuntos libres de chat ni servicios externos.
