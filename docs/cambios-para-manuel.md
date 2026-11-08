# Actualización para Manuel — Antiq Nebula

Manuel, la última versión que viste en GitHub fue `aecbd000284c7578b45f32354c08f78326573d2f`. Esta entrega reúne lo desarrollado desde entonces, incluidas las adaptaciones pedidas por Luis. El alcance sigue siendo una aplicación funcional con backend mock local y contratos preparados para que la conectes a la central de Antiq. No se activó ningún proveedor de identidad, almacenamiento o pagos de producción.

## Lo que se resolvió de tu handoff

**Colaboraciones y consistencia visual.** Se unificaron controles, espacios, tipografía, bordes, estados y navegación de retorno. Se sustituyó la regla universal que forzaba todos los radios a cero por una política compartida que permite excepciones deliberadas. Los espacios de trabajo conservan borradores, archivos seleccionados y contexto durante los flujos previstos; las revisiones y los términos históricos no se reemplazan silenciosamente.

**Navegación y Search.** Los accesos de regreso usan un componente común y un destino explícito. Home y Search recuperan su búsqueda y filtros; Discovery recupera una publicación por ID. Los cambios sin guardar tienen protección al salir. Search corrigió la alineación de icono, texto y limpieza, y maneja debounce, composición, cancelación, errores y respuestas obsoletas.

**Notificaciones dentro de la pantalla.** La campana abre un panel compartido sin sustituir la página. Conserva formularios y contexto, pausa medios y no los reanuda automáticamente. Se mantiene `/notifications` como entrada compatible. La consulta de resumen tiene un único propietario de polling; la lectura colectiva llega solo hasta el último ID observado.

**Remix privado y editable.** Se reemplazó la creación de remixes públicos por `/studio/remix`, con borradores privados reanudables, aportaciones persistentes, selección, volúmenes, revisión y resultados guardados. Los enlaces antiguos siguen resolviendo de forma segura. Un GET no crea trabajo. Los remixes publicados históricamente se conservan. El resultado final puede enviarse como propuesta a participantes autorizados; eso no concede edición del borrador ni crea una publicación pública.

**Remix y rendimiento.** El selector muestra la onda real, con un único botón cíclico de duración, desplazamiento del fragmento, zoom, vista general y cursor independiente. Los extremos mueven el fragmento de duración fija y están nombrados así. Sus áreas táctiles de 44 px permanecen separadas incluso con un fragmento pequeño y zoom alejado. Los volúmenes son independientes, visibles y reiniciables; modificar la mezcla invalida la vista previa. Discovery limita los elementos multimedia al activo y sus vecinos y evita políticas de scroll competidoras. Se conserva un benchmark reproducible contra tu baseline, con Chrome y WebKit. Las cifras y límites de esa medición están en el handoff técnico.

## Cambios de producto posteriores

**Home para artistas y visitantes.** `/explore` funciona como Home de oportunidades: proyectos con ofertas creativas activas o financiación activa. El entorno Investor conserva su catálogo. La portada pública `/` sigue separada. El encabezado de Home se refinó sin rehacer las tarjetas ni el reproductor.

**Búsqueda contextual y Project Browser.** Home incorpora búsqueda en vivo, autocompletado, sugerencias reales e historial por identidad. Texto y filtros se combinan sobre el inventario elegible completo antes de paginar. Los filtros admiten varios tipos de proyecto, géneros del artista, participación y compensación; OR dentro de una dimensión y AND entre dimensiones. Necesidad y compensación deben coincidir en la misma oferta. Un proyecto aparece una sola vez. Los filtros se muestran en un panel responsive y como etiquetas eliminables.

**Modos de descubrimiento.** Recently created usa `createdAt` y no simula una fecha de publicación. Following ya es funcional y usa relaciones reales. For You pasó de un orden general provisional a una primera afinidad basada en las preferencias privadas y, cuando corresponde, la identidad pública del artista. No es un modelo de IA ni usa mensajes privados o dinero invertido. Ordena después de filtrar; cambiar preferencias reinicia el orden sin eliminar búsqueda ni filtros. Sin señales o coincidencias utiliza un fallback general explicado en la interfaz.

**Identidad profesional, onboarding y perfil público.** Artist puede tener varios roles, géneros y preferencias. Se añadieron taxonomías estructuradas, campos públicos profesionales y preferencias privadas de colaboración/descubrimiento. El onboarding guarda su avance y puede retomarse. Sus selectores usan opciones en cuadrícula. No se impone un único rol creativo ni se cambia el tipo de cuenta Investor. El perfil público muestra solo la proyección autorizada; una colaboración privada no se convierte automáticamente en crédito público.

**Géneros conectados a búsqueda.** Home y Search global reutilizan los géneros existentes del perfil, con compatibilidad para texto antiguo y procedencia explícita. No se inventó un género de proyecto. Borrar una selección estructurada no debe reactivar texto antiguo oculto. El modelo queda preparado para géneros de proyecto cuando se rediseñe su creación.

**Autenticación y edición concurrente.** Se corrigieron respuestas tardías que podían restaurar una identidad después del logout, carreras logout/login y sobrescrituras de perfil entre pestañas. El editor guarda solo cambios y detecta conflictos del mismo campo; los cambios independientes se combinan. Las preferencias privadas se conservan. En el cierre de esta entrega se reforzó también la identificación de sesión con rol + ID para no depender de que dos dominios numéricos nunca coincidan al integrar la central.

**Following y grafo social.** Hay Follow/Unfollow real entre Artist, contadores, listas paginadas, actualización de estado por cuenta y conexión con Home. Seguir no concede acceso a proyectos privados ni derechos de colaboración. Los cambios de cuenta no reutilizan el estado social anterior.

**Avisos sociales compatibles.** Las notificaciones ya pueden apuntar a colaboración, perfil o conversación. Follow y su aviso se guardan en una transacción; los reintentos no duplican avisos. Unfollow conserva el historial y un Refollow real genera una nueva ocurrencia. Los destinos eliminados quedan como avisos históricos sin enlaces operativos. No hay push/email ni promesa de entrega instantánea: se mantiene polling.

**Mensajería unificada.** `/messages` reúne conversaciones y Requests. Un mensaje aislado a otro artista llega como solicitud; el destinatario acepta o rechaza antes de conversar. Las oportunidades tienen solicitudes formales con propuesta, términos y archivos. El hilo mantiene su contexto de proyecto/oferta/canción. Las notificaciones llevan al hilo correcto. Las colaboraciones anteriores conservan sus mensajes, archivos, revisiones, condiciones y accesos compatibles; no se migraron a chats vacíos. Los reintentos de las nuevas operaciones usan claves persistentes para evitar duplicados.

**Ajustes de navegación móvil.** Se retiraron el perfil duplicado y More del encabezado móvil. More y Logout están dentro de Profile; desktop conserva su ubicación. Received se accede desde la tarjeta existente Contributions received del perfil y conserva su propia pantalla, totales y filtros. La barra Artist móvil queda con Discovery, Home, Search, Messages y Profile. Pledges de Investor no cambió. La atribución visual de la aplicación se cambió a antiq; la autoría histórica del código no se reescribe.

**Discovery móvil inmersivo.** Video y audio ocupan el área disponible sobre la barra inferior, sin encabezados de Nebula/Discovery. Video usa cover con controles superpuestos; audio conserva portada grande. La miniatura de video y la portada de audio abren el proyecto cuando hay un vínculo accesible. Se preservan la ficha rápida, ofertas, permisos, interacciones, paginación y regreso a la publicación. Tablet y desktop mantienen su presentación.

**Canciones dentro de proyectos.** Single, EP y Album pueden tener una lista ordenada de canciones propias reutilizables. Las canciones tienen identidad estable, título, descripción y revisión; no son medios ni un ledger de regalías. Una oferta o publicación puede pertenecer al proyecto completo o a una canción concreta. El contexto se conserva en Home, Discovery, propuestas y mensajes mediante `?song=ID`. No se crean chats, tarjetas o reproductores duplicados. Cambiar de orden no rompe enlaces; las dependencias históricas bloquean retiradas destructivas. Los proyectos antiguos no reciben canciones inventadas.

## Lo que conservamos y lo que no estamos afirmando

Se mantienen las cuentas, proyectos, publicaciones, archivos y transacciones locales existentes. La financiación sigue siendo una simulación en USD: ni aceptar una colaboración ni indicar un split ejecuta pagos, contratos legales o reparto de regalías. Los remixes nuevos siguen privados. No hay una integración productiva con la central de Antiq ni un sistema de identidad alternativo destinado a reemplazarla.

El repositorio público contiene código, pruebas con datos sintéticos y documentación. No contiene la base de datos de Luis, contraseñas, sesiones, mensajes ni sus archivos privados. Sus ejemplos y subidas permanecen en el entorno local; no son semillas públicas.

La siguiente integración necesita confirmar contigo identidad/sesión, IDs, revisiones, propiedad de datos, almacenamiento y descargas privadas, errores/paginación/idempotencia, eventos y semántica financiera. Los puntos fuera del alcance local —dispositivo físico, Safari real, condiciones de producción y decisiones de la central— están señalados como pendientes, con responsable y siguiente acción, y no como trabajo ya certificado.

La lista exacta de contratos, migraciones, pruebas, resultados y excepciones acompaña esta actualización en `docs/manuel-release-handoff.md` y `docs/integration-contracts.md`, además del PDF técnico en inglés.
