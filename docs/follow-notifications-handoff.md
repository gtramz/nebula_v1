# Notificaciones compatibles y Follow — entrega para Manuel

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

Fecha de implementación: 7 de noviembre de 2026 (hora de Ciudad de México).

## Alcance y orden de entrega

La campana, el panel adaptable y `/notifications` comparten el historial de colaboración y los nuevos avisos Artist→Artist. Etapa A se validó antes de conectar la mutación Follow: cinco pruebas específicas de migración/contrato y dos regresiones API de colaboración y avisos. Después se integró Follow y se amplió la verificación, incluida migración en disco y reinicio.

No hay endpoint genérico de creación de avisos, mensajería general, Follow back, avisos de otras actividades, preferencias nuevas, recomendaciones, push, servicios externos ni cambios visuales de onboarding. Following, búsquedas por géneros, permisos y reglas de elegibilidad mantienen su implementación existente.

## Contrato público

`lib/local/src/notifications.ts` define una unión discriminada por `kind`:

```ts
// Campos comunes
{ id, actorId, actorName, createdAt, readAt }

// Colaboración: tipos anteriores conservados
{ kind: 'contact' | 'message' | 'submit' | 'request_changes' |
        'accept' | 'reject' | 'withdraw' | 'deliver' | 'complete' |
        'offer_updated' | 'offer_closed',
  collaborationId, projectTitle, need,
  target: { type: 'collaboration', id: collaborationId, available } }

// Follow: no collaborationId, projectTitle ni need ficticios
{ kind: 'artist.followed',
  target: { type: 'artist', id: actorId, available } }
```

Los datos de identidad son el ID y nombre público actualmente disponible. El aviso no copia perfiles completos, preferencias, texto de mensajes ni medios. `notificationHref` construye exclusivamente `/collaborations/:id` o `/artist/:id` a partir de referencias positivas, consistentes y disponibles. No acepta URLs del cliente. Conserva compatibilidad de lectura con los DTO antiguos de colaboración sin `target`; todos los DTO del servidor actualizado incluyen el destino tipado.

Endpoints conservados:

| Ruta | Comportamiento |
|---|---|
| `GET /api/notifications/summary` | `unreadCount`, `latestId` de la sesión Artist |
| `GET /api/notifications?before=ID` | Hasta 30 avisos mixtos, descendentes por ID; `nextCursor` y resumen |
| `PATCH /api/notifications/read` | `{id}` o `{throughId}`; propiedad verificada; lectura idempotente |

El cliente nunca elige el destinatario. Visitantes: 401; Investor: 403. Las mutaciones conservan controles de origen, cabecera, sesión y frecuencia. El marcado colectivo afecta solamente IDs hasta el último observado; los avisos posteriores permanecen sin leer.

## Migración SQLite e historial

`server/notifications.ts` detecta la tabla antigua por ausencia de `target_kind` y reconstruye `artist_notifications` dentro de `BEGIN IMMEDIATE`/`COMMIT`. Cualquier fallo revierte la reconstrucción.

- Conserva exactamente `id`, `recipient`, `actor`, `thread`, `kind`, `created`, `read_at`.
- Comprueba la copia de las columnas históricas antes de reemplazar la tabla.
- Conserva índices y triggers definidos, así como el valor máximo histórico de `sqlite_sequence`, incluso si se habían eliminado IDs superiores.
- `thread` pasa a ser nullable. Añade `target_kind` (por defecto `collaboration`), `target_artist` y `occurrence_key` opcional.
- Los registros anteriores se clasifican como colaboración; no se reescriben sus fechas, lecturas, contexto ni IDs.
- Un CHECK impide combinaciones incoherentes entre tipo, destino y referencia. El índice único parcial `notifications_occurrence` aplica solamente a claves de ocurrencia no nulas.
- Los siguientes arranques son idempotentes. No se borra ni reinicializa una tabla incompatible.
- No hay FK ni borrado en cascada de la notificación hacia `artist_follows`.

El listado utiliza LEFT JOIN restringido a colaboraciones en las que el destinatario participa. Una colaboración ajena, ausente o con contexto inválido aparece como `Collaboration unavailable`, sin recuperar su información privada. Un Artist eliminado coherentemente de cuenta y perfil aparece como `Artist unavailable`. El aviso conserva fecha y lectura, pero no enlace operativo. Una base globalmente corrupta sigue siendo rechazada por el validador existente; esta entrega no oculta corrupción del almacenamiento.

La instalación nueva y la migración no crean avisos retroactivos para relaciones existentes.

## Transacción y política de ocurrencias

`server/app.ts` crea **una instancia** de `notifications`, compartida con `collaborations` y la mutación Follow. `server/transaction.ts` contiene el helper síncrono utilizado por ambos flujos. Las transacciones de trabajo existentes siguen agrupando su acción y aviso.

`PUT /api/artists/:id/follow` deriva al seguidor de la sesión, valida cuenta y perfil Artist de ambos extremos, conserva el límite de 120 cambios/minuto/cuenta y ejecuta:

1. Abrir transacción SQLite.
2. Insertar relación mediante la restricción única `(follower, artist)`.
3. Solo si hubo inserción, guardar el aviso con `occurrence_key = artist.followed:<relationshipId>`.
4. Commit; después responder al cliente.

No hay awaits ni transacciones anidadas dentro de este bloque. Una inserción fallida de aviso revierte también la relación. La clave es persistente: sobrevive a reinicios y a la eliminación de la relación.

| Operación | Resultado |
|---|---|
| Primer Follow efectivo A→B | Un aviso a B; actor y destino A |
| Repetición, concurrencia o reintento | Ningún aviso adicional; fecha y lectura originales intactas |
| Unfollow | Elimina solo la relación; mantiene el historial |
| Refollow efectivo | Nueva relación autoincremental; exactamente un aviso nuevo |
| Relación anterior a la entrega | Ninguna notificación retroactiva |
| Mensajes legítimos de colaboración | Conservan avisos independientes; no usan esta deduplicación |

## Experiencia y aislamiento de sesión

El aviso muestra `started following you`, identidad pública, fecha, estado Read/Unread y **View artist** cuando el destino existe. Los avisos de colaboración mantienen sus acciones. Los textos generales ahora incluyen colaboraciones y seguidores.

Se reutilizan el drawer/sheet, foco y Escape, cierre al navegar, protección de trabajo sin guardar, pausa de medios y bloqueo de campana durante operaciones del estudio. No se modificó el layout. Se mantiene un único polling de resumen de 10 segundos y actualización al recuperar foco; no se promete entrega instantánea.

Las consultas siguen separadas por Artist y se cancelan al cambiar de identidad. Se añadió una comprobación de cancelación después de invalidar la lista en la operación de lectura, evitando que una respuesta abandonada navegue más tarde. No cambió el mecanismo de autenticación.

## Archivos de esta entrega

| Archivos | Responsabilidad |
|---|---|
| `lib/local/src/notifications.ts`, `lib/local/src/index.ts` | Unión discriminada, destinos y exportaciones |
| `server/notifications.ts` | Migración, servicio mixto, historial y unicidad persistente |
| `server/transaction.ts` | Transacciones síncronas compartidas |
| `server/app.ts`, `server/collaborations.ts`, `server/follows.ts` | Inyección única, Follow atómico, conservación del flujo de trabajo |
| `artifacts/nebula/src/features/notifications/index.tsx` | Presentación y navegación por tipo, cancelación tras lectura |
| `lib/local/src/notifications.test.ts` | Validación de destinos y compatibilidad |
| `server/notifications.test.mjs`, `server/follow-notifications.test.mjs` | Migración, reinicio, rollback, ocurrencias y seguridad |
| `tests-collaborations/follow-notifications.spec.ts` | Dos contextos, lectura, historial y carreras de sesión en escritorio/móvil |
| `tests-collaborations/notifications.spec.ts`, `tests-collaborations/notification-panel.spec.ts` | Texto general para Investor y protección de Remix al abrir ambos tipos de destino |
| `server/README.md`, `docs/following-phase-2-1.md`, este documento | Contrato y límites actualizados |

Los demás cambios que ya existían en el árbol de trabajo pertenecen a entregas previas y se conservaron. No se añadieron dependencias.

## Verificación y activación

Las pruebas usan bases, cuentas y medios desechables. Evidencia local: `../auditoria/follow-notifications-2026-11-07/`. El informe `verification.json` contiene el resultado final por suite y la comparación de preservación; los logs conservan los comandos y resultados.

La activación requiere copia consistente de SQLite y copia de medios, actualización conjunta de backend/frontend y comparación de filas originales y hashes. Se preservan los assets anteriores con nombre de contenido para pestañas abiertas. Recargar localhost carga la versión nueva. El respaldo permite volver a la pareja anterior de código y datos.

## Límites que permanecen

- Funcionamiento en el servidor local SQLite conectado; no se añadió integración con la central de Antiq ni entrega distribuida.
- No hay push, entrega instantánea, agrupación, preferencias, Follow back ni mensajería general.
- La eliminación de cuentas no tiene flujo de producto; se verificó la tolerancia de destinos ausentes con fixtures aislados.
- Chrome móvil es emulación, no evidencia de un teléfono físico o Safari real.
- Se conservan las advertencias de compilación existentes sobre tamaño del bundle y sourcemaps de componentes UI.
- El selector visual del onboarding se implementó posteriormente con `TaxonomyMultiSelect`; no pertenecía a esta entrega.


## Resultado final de esta entrega

Activado en `http://127.0.0.1:4174/explore`. Recargar la página carga la nueva interfaz. Build servido: `index-C74ZiWsi.js`; el hash HTTP coincide con el archivo compilado.

| Validación | Resultado final |
|---|---:|
| Vitest: dominio, sesión, preferencias, historial, búsqueda, géneros y destinos | 66/66 |
| Node/API: todos los tests de servidor, incluida migración y Follow atómico | 42/42 |
| Navegador: Follow y carreras de sesión | 10/10 |
| Navegador: panel y avisos anteriores | 8/8 |
| Navegador: colaboración completa e interfaz | 12/12 |
| Navegador: Following y géneros | 8/8 |
| Navegador: Home, búsqueda contextual y facetas | 18/18 |
| Navegador: sesión, identidad y preferencias privadas | 12/12 |
| Navegador: perfiles, onboarding y taxonomías | 10/10 |
| Navegador: navegación, Discovery/social, Investor e historial USD | 14/14 |
| Navegador: estudio unificado y borradores privados | 14/14 |
| Navegador: grabación, exportaciones de audio/video y propuestas | 10/10 |
| TypeScript de biblioteca, UI y servidor; build Vite; diff check | Correctos |

Son **116 casos distintos de navegador**, ejecutados en Chrome escritorio y móvil emulado. Se repitieron además cuatro casos sobre el build final, reforzados para simular pérdida real de la respuesta de Follow tras commit y para cancelar la navegación desde Remix hacia ambos destinos: **4/4**. No se relajaron expectativas de producto ni límites de frecuencia.

Las siete pruebas específicas del servicio cubren copia histórica, índices, rollback durante reemplazo e índices, secuencias vacías y altas, disco/reinicio, paginación mixta, lecturas y destinos ausentes/ajenos. Tres pruebas API de Follow cubren concurrencia/reintentos, Unfollow/Refollow, reinicio, ausencia de backfill, referencias falsificadas y rollback de relación por fallo del aviso. Estas diez pruebas están incluidas en las 42 de servidor, no sumadas otra vez.

Preservación comprobada tras activación: **19 tablas** idénticas en sus columnas originales, incluida `sqlite_sequence`; **3 cuentas, 3 perfiles Artist, 7 proyectos, 4 publicaciones, 1 relación Follow y 5 archivos** conservados. El historial local de avisos estaba vacío y permanece vacío (0→0), sin backfill. La conservación de avisos históricos leídos/no leídos se verificó con fixtures temporales. `PRAGMA integrity_check`: **ok**. El smoke anónimo confirma 401 en listado/resumen y no inicia sesión en cuentas reales.

Respaldo final: `.data/backups/before-follow-notifications-activation-20261108T020114Z/` (SQLite, medios, frontend anterior y copias del backend anterior/candidato). Log activo: `.data/follow-notifications-server.log`; PID en `.data/follow-notifications-server.pid`. El primer intento de respaldo de solo lectura se detuvo al faltar los auxiliares WAL tras el cierre; se completó con una conexión de solo consulta. No se modificó ninguna fila durante ese ajuste.

No quedan fallos abiertos en el alcance probado. Persisten únicamente los límites de esta entrega y las advertencias preexistentes de build indicadas arriba. Los resultados finales se toman de `api-final.log`, `final-build-checks.log`, los logs de cada suite y `final-edge.log`; los intentos intermedios no sustituyen esa evidencia.
