# Canciones dentro de proyectos — contrato local para Manuel

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

## Alcance implementado

Project sigue siendo el contenedor de financiación, presentación y oportunidades. No se crea un objeto Release. Single, EP y Album permiten registrar canciones en desarrollo, sin subir archivos ni declarar un lanzamiento terminado. Los demás formatos mantienen su editor existente.

En Profile → New/Edit project se pueden añadir canciones, reutilizar las propias, editar título/descripción y ordenar con botones accesibles Move up/Move down. Los proyectos nuevos guardan sus canciones junto con el proyecto en una transacción; abrir/cancelar no crea registros. En proyectos existentes, Save songs guarda exclusivamente canciones y lista; Save project envía solamente los campos modificados con baseline. Los borradores pendientes de la lista deben guardarse o recargarse antes de guardar detalles del proyecto.

## Modelo y fuentes canónicas

- `works`: ID autoincremental estable, propietario administrativo, título, descripción, revisión y fechas. No representa copyright, reparto de derechos ni un archivo.
- `project_works`: pertenencia explícita y posición por proyecto; clave única proyecto/canción y proyecto/posición. Una canción propia puede estar en varios proyectos propios sin duplicarla.
- `project_tracklists`: revisión de la lista por proyecto; sin fila implica revisión 0 y lista vacía.
- `work_operations`: clave de operación por propietario, firma del contenido y respuesta para reintentos. Se escribe dentro de la misma transacción.
- Project y sus datos financieros permanecen en el almacenamiento actual; posts, medios, ofertas y conversaciones conservan sus IDs y tablas.

Los títulos editados se actualizan en los contextos actuales que incluyen esa canción. Los términos históricos de propuestas conservan su título original.

## Contrato HTTP

| Operación | Contrato |
|---|---|
| `GET /api/projects/:id/songs` | `{ revision, songs }`; acceso contextual según visibilidad del proyecto. Cada canción incluye referencias impeditivas solo para el propietario. |
| `GET /api/works` | Biblioteca de canciones del artista autenticado. No existe catálogo público genérico por workId. |
| `PUT /api/projects/:id/songs` | `{ operationId, revision, songs: [{ workId?, revision?, title, description }] }`; orden del array = orden de la lista. Máximo 100. |
| `DELETE /api/works/:id` | `{ operationId, revision }`; solo propietario, sin pertenencias ni referencias históricas. No elimina medios ni dependencias. La UI de esta entrega retira de listas; no añade una pantalla de borrado de biblioteca. |
| RPC `createProject` | Campos existentes + `songs?`, `operationId?`; operationId es obligatorio cuando se envía songs; la UI nueva lo genera. Operación atómica y reintentable. |
| RPC `updateProject` | Patch de campos cambiados + `expected` con valores base. Conflicto 409 si cambió un campo que se intenta guardar. |
| Ofertas | `workId?: number \| null`; título de contexto generado por servidor. Proyecto obligatorio y pertenencia/autoría comprobadas. |
| Publicaciones | `workId?: number \| null`; requiere projectId compatible. DTO añade `song` autorizada o null cuando el contexto deja de ser visible. |
| `GET /api/publications?project=:id&song=:id` | Publicaciones públicas de esa pertenencia, paginación existente de 20 y cursor `before`. Proyecto/canción deben ser públicamente visibles. |

Omitir workId al editar con un cliente antiguo conserva el vínculo existente; enviar null lo retira explícitamente, sujeto a las restricciones del recurso. Las escrituras de ofertas/posts conservan sus revisiones existentes. No hay endpoints de upload o reproducción para Work.

## Ofertas, Home y solicitudes

Una oferta sin canción se muestra como **Project-wide**. Una oferta de canción se muestra como **For: [title]**, dentro de esa canción; New offer desde ella preselecciona su ID sin crear datos al abrir el editor.

Home mantiene el agregado existente por projectId: el mismo EP aparece una vez aunque tenga varias canciones, ofertas y publicaciones. Las ofertas solo vuelven elegible a su propio proyecto; reutilizar una canción no propaga oportunidades a otros proyectos. Búsqueda, filtros, matching rol/compensación en la misma oferta, For You, Following, fechas y paginación usan sus mecanismos existentes. Global Search no busca canciones. La búsqueda contextual de Home conserva sus campos anteriores; el título de canción identifica el alcance de la oferta, sin añadir un buscador independiente de canciones.

Los snapshots existentes de la conversación y de cada propuesta guardan workId/workTitle. Lista, encabezado y términos permiten recuperar Proyecto → Canción → Oportunidad dentro del mismo hilo. El enlace de proyecto conserva `?song=:id`. No se crea otro chat ni se cambian admisión, aceptación, entrega, mensajes o notificaciones. Después de cualquier solicitud histórica de la oferta, cambiar su canción queda bloqueado con 409, incluso si la solicitud fue rechazada o retirada. Renombrar la canción no reescribe términos anteriores.

## Publicaciones y navegación

El formulario existente acepta publicación independiente, solo proyecto o proyecto+canción. Cambiar de proyecto limpia la selección y muestra un aviso. Guardar la asociación conserva los campos explícitos de estado, medio y permiso Remix; nunca crea una publicación adicional por la asociación.

La portada/enlace contextual de Discovery y Open full project llevan a `/project/:id?song=:workId`. El detalle valida la pertenencia visible, resalta el ID estable y lo desplaza a la vista. Reordenar no rompe el enlace. Un ID ajeno no consulta otra canción ni intenta una coincidencia aproximada. Las publicaciones públicas independientes sobreviven al archivo del proyecto; el contexto oculto devuelve null y no produce un enlace ficticio. Se mantiene el retorno existente a Home/Discovery.

El detalle enlaza las publicaciones públicas relacionadas al reproductor existente en Discovery. No fabrica preview, waveform ni reproductor de Work. Un proyecto draft no consulta publicaciones públicas como si fuera accesible.

## Privacidad, retirada y concurrencia

La metadata deliberadamente incluida sigue la visibilidad del proyecto. El editor avisa antes de guardar en un proyecto público. La biblioteca es privada del artista. Investor y terceros solo leen contextos públicos; colaborar o seguir no concede edición. Los permisos de medios y borradores permanecen independientes.

Retirar de la lista no borra la canción. Se bloquea si hay ofertas —abiertas, cerradas o con historial— o posts —incluidos borradores y retirados— que dependan de esa pertenencia. El borrado de la canción requiere que no esté incluida ni referenciada. Las pertenencias de proyectos archivados se conservan; esta fase no añade un flujo de purgado. No hay cascadas sobre propuestas, archivos, publicaciones, mensajes, recibos ni historiales.

Guardar listas exige la revisión de la lista y de cada canción existente. Un formulario antiguo recibe 409, mantiene su borrador y permite Reload songs con confirmación. Editar una canción desde otro proyecto también invalida su revisión. La escritura, el orden y la clave idempotente se confirman o revierten juntos. No se deduplica por nombre.

## Migración y compatibilidad

Migración aditiva transaccional con cuatro tablas e índices; no reescribe filas históricas. Arranques repetidos usan CREATE IF NOT EXISTS. No genera canciones a partir de publicaciones, Singles, archivos o colaboraciones antiguas. Los registros sin workId siguen siendo válidos. El modo navegador anterior permanece disponible con sus funciones existentes; la edición estructurada de canciones requiere el servidor local y no simula multiusuario con localStorage.

## Archivos de esta entrega

- `lib/local/src/works.ts`, `index.ts`, `types.ts`, `collaborations.ts`, `publications.ts`: contrato de presentación y campos opcionales.
- `server/works.ts`, `app.ts`, `collaborations.ts`, `messages.ts`: persistencia, validaciones, contexto y snapshots.
- `artifacts/nebula/src/features/songs/index.tsx`: controles y detalle contextual.
- `artifacts/nebula/src/pages/profile.tsx`, `project.tsx`, `publications.tsx`, `discovery.tsx`: integración con pantallas existentes.
- `artifacts/nebula/src/features/collaborations/index.tsx`, `features/opportunities/index.tsx`: alcance de ofertas y enlaces.
- `artifacts/nebula/src/features/discovery/{demo-posts.ts,live-discovery.tsx,cover-artwork.tsx,media-player.tsx}`: referencia opcional y destino contextual; no cambia ranking ni reproducción.
- `server/works.test.mjs`, `tests-shared/project-songs.spec.ts`: pruebas nuevas.

## Límites pendientes

Sin géneros de proyecto/canción, nuevas compensaciones o roles, masters/versiones, créditos, distribución, derechos inferidos, Featured Preview obligatorio ni búsqueda global de canciones. Sin conexiones externas. La estructura permite extender estos conceptos después, sin atribuirles comportamiento inexistente.

## Verificación final — 7 de noviembre de 2026

- **70/70 pruebas unitarias** (`pnpm test`).
- **79/79 pruebas API/integración** (`node --test server/*.test.mjs`), incluidas las cinco pruebas nuevas de canciones con múltiples aserciones: creación atómica/reintentos, revisiones, reutilización, permisos, contexto, snapshots, referencias, rollback, migración y arranque repetido.
- **158 casos distintos de navegador aprobados** en Chrome de escritorio y emulación móvil, descontando repeticiones. Incluyen el recorrido completo de cinco canciones, Home, búsqueda, filtros, géneros, Following, For You, cuentas, onboarding, perfiles, Investor/historial, mensajería, colaboraciones, notificaciones, Discovery, Remix y retorno.
- La pasada ampliada se complementó con **14/14 comprobaciones de canciones y autenticación** después de reforzar la separación de la caché por rol. Tras el último ajuste visual de desplazamiento, se recompilaron los archivos y se repitieron **4/4 recorridos de canciones**. Se verificó que el título de la canción resaltada quede dentro del viewport móvil.
- TypeScript de UI/librerías y compilación del servidor: correctos. Nuevo build de producción: correcto. `git diff --check`: sin errores. El bundler conserva la advertencia de tamaño superior a 500 kB del archivo principal; no impide la compilación.

### Incidencias de la ejecución de pruebas

La ejecución conjunta de notificaciones agotó el límite de intentos de autenticación en su base temporal. Las tres suites se repitieron por separado con nuevas bases: Follow **10/10**, panel **6/6**, notificaciones de trabajo **2/2**. No se modificaron los límites ni se debilitaron expectativas.

Los diez casos adicionales de retorno para Safari/WebKit **no pudieron iniciarse**: falta el ejecutable `webkit-2370/pw_run.sh`. Los diez equivalentes de Chrome escritorio/móvil pasaron. No se afirma compatibilidad verificada con Safari ni con dispositivos físicos.

Los primeros fallos de las pruebas nuevas fueron selectores que no coincidían con los nombres accesibles completos o con el acceso propio de escritorio; se corrigieron los selectores conservando las mismas verificaciones del producto.

### Activación y preservación

Frontend y servidor activados juntos en **http://127.0.0.1:4174**. Acceso al editor: **Profile → New project / Edit project → Songs**.

Respaldo previo: `.data/backups/before-project-songs-20261108T050432Z/`, con SQLite consistente, medios, frontend anterior y copia del servidor candidato. La copia del servidor de ese respaldo es el candidato nuevo, no se presenta como una copia del ejecutable anterior.

Comparación anterior/posterior:

- 24 tablas originales: 23 idénticas por contenido; la única variación fue `rate_limits`, de uso temporal.
- Cuenta, proyectos, publicaciones, relaciones, mensajes, propuestas, términos, historial y sesiones: conservados.
- Cuatro tablas nuevas, todas vacías tras activar: `works`, `project_works`, `project_tracklists`, `work_operations`. No se crearon canciones ni cuentas de prueba en la base real.
- Los cinco archivos existentes conservan exactamente sus hashes.
- `PRAGMA integrity_check`: `ok`.
- El HTML activo y sus assets se compararon con el build verificado. JavaScript activo: `index-1mYosz1b.js`; CSS: `index-C8CfVQdK.css`.

Evidencia local reproducible: `.data/project-songs/final-verification.json`, `preservation-result.json`, `live-assets.json`, `release-manifest.json` y los logs de cada suite. Capturas finales: `.data/project-songs/release-visual/`. Las cuentas, bases y medios de prueba fueron temporales.

No se identificaron fallos funcionales pendientes en el alcance implementado. Quedan fuera de esta verificación Safari/WebKit y dispositivos físicos; los límites de producto descritos arriba permanecen deliberadamente pendientes.
