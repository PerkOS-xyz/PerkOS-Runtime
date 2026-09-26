# EQLTY con ENS V2: nodos móviles y decisiones verificables

Estado: implementación autorizada el 27 de septiembre de 2026. Runtime #89 está fusionado; API #294 y EQLTY #10 siguen abiertos. Este documento describe la aceptación requerida, no certifica un despliegue público. Dynamic y Sepolia pública siguen pendientes.

## Resultado para la persona

Una persona identifica un desk por su nombre ENS, mueve su rama a otro espacio autorizado, consulta quién participó en una decisión y comprueba la procedencia e integridad de la evidencia publicada. Cada agente tiene un ámbito de escritura separado. La movilidad y la revocación cambian el comportamiento de Runtime de forma visible. Julio añadió explícitamente que los nodos ENS V2 deben poder moverse.

La identidad deja de ser una ficha aislada: acompaña al trabajo real del equipo y permite verificarlo fuera de la sesión privada del propietario. ENS verifica vínculos y autoridad; no demuestra que una conclusión financiera sea correcta.

## Alternativas y recomendación

1. **Equipo móvil por nombre y expediente verificable de una decisión. Recomendado.** Usa los siete agentes existentes, los resolvers separados y la publicación/revocación ya probadas. Requiere una nueva política de movilidad, descubrimiento público, conexión con respuestas reales, formato de evidencia y un lector independiente. Tiene una demostración completa sin depender de una venta o de un servicio externo.
2. **Invitar a un especialista por ENS.** Aporta descubrimiento y colaboración entre aplicaciones. Es una extensión posterior: el checkout actual conserva campos de invitados, pero no implementa incorporación y ejecución por nombre. Requiere endpoints autenticados, validación del destino y del servicio, consentimiento sobre el contexto enviado y un modelo separado de los siete asientos base.
3. **Transferir un equipo completo.** Tiene valor de marketplace, pero exige coordinar tokens hijos, resolvers, ERC-8004, wallets y propiedad de datos. Transferir el nombre del desk por sí solo no entrega todo eso. No forma parte de la demostración recomendada.

## Guion de demostración

1. **Abrir por nombre.** En una vista pública, resolver un nombre de desk de ejemplo y descubrir su manifiesto público y los siete asientos. Comprobar parent y child pointers, propietarios, resolvers y asociaciones ERC-8004/ENSIP-25. Una lista obtenida de ENS no equivale por sí sola a una identidad verificada.
2. **Pedir un análisis real.** Desde la sesión del propietario, crear una oportunidad identificada por un `decisionId`. Scout aporta fuentes; Risk evalúa riesgos; Quote aporta una cotización con vigencia; Hooks aporta evidencia sobre hooks cuando corresponda; Treasury aporta su análisis de configuración; Trader prepara la propuesta bajo sus controles actuales; Auditor compone el expediente. Mostrar estados pendiente, completado, fallido o no aplicable. No fingir que los siete ejecutan cada tarea ni inventar aportes para llenar la pantalla.
3. **Publicar evidencia seleccionada.** Mostrar una vista previa del paquete público y requerir la acción explícita del propietario. Los seis asientos escritores publican únicamente la referencia o hash de su aporte, en su clave permitida y con su propia wallet. Trader conserva identidad sin escritura ENS. El expediente identifica exactamente las contribuciones que contiene.
4. **Mover y verificar desde otra sesión.** Mover la rama del desk entre dos espacios del mismo propietario, por ejemplo `eqlty.lab.ensv2-demo.eth` → `eqlty.portfolio.ensv2-demo.eth`. Estos nombres son ilustrativos. El nuevo nombre debe descubrir el mismo registro de equipo y los mismos agentes, wallets e IDs ERC-8004, una vez actualizadas todas las referencias. Abrir el nuevo nombre y un expediente exportado o publicado desde otra sesión. Leer la cadena y el contenido público para comprobar autoría de las transacciones, nombres, claves, hashes y recibos. No exigir la base privada de PerkOS para esa comprobación. Mostrar explícitamente qué se pudo comprobar y qué contenido no está disponible.
5. **Revocar en vivo.** Retirar la escritura de Risk. Su siguiente publicación queda bloqueada y el nuevo expediente muestra que falta esa contribución verificable. El nombre del agente y el historial anterior se conservan. La revocación no vuelve falsos retroactivamente los recibos anteriores ni modifica por sí sola las políticas de trading.
6. **Demostrar la jerarquía.** Como prueba separada en una rama de demostración, desconectar el child pointer. Runtime detecta la incoherencia con el parent pointer y deja de validar la rama para nuevas publicaciones. Este paso requiere control real de la entrada padre; la app no debe mostrar una acción que la wallet activa no puede ejecutar.

## Integración visible en Runtime

- **Abrir por nombre:** entrada al manifiesto y lector público, con una separación clara entre inspeccionar y operar un desk.
- **Decisión:** cada aporte muestra su agente ENS y estados independientes: producido, pendiente de publicación, confirmado y verificado. Un trabajo privado no publicado no recibe una etiqueta de evidencia pública.
- **Ver evidencia:** expediente con el contenido elegido, hash, nombre, wallet firmante, clave, red, bloque y transacción. Acceso al mapa parent/child y a los permisos actuales.
- **Identidad:** pasaportes de los siete agentes y administración de publicación. Mostrar al operador, que conserva administración de los resolvers.

Los pasaportes, mapa y actividad propuestos visualmente son vistas de este flujo. La acción principal sigue siendo producir y comprobar una decisión del desk.

## Movilidad solicitada: comportamiento y permisos

La primera demostración prioriza **mover la rama completa del desk entre padres controlados por el mismo propietario**, con sus siete entradas de agente. Cambiar el padre conserva el contrato del subregistro y sus entradas internas, pero requiere una entrada de montaje en el destino; no implica conservar el token de montaje del padre anterior. Cambiar de propietario es un flujo adicional, no una consecuencia de mover la rama.

La interfaz ofrece **Mover nodo…**, selecciona un padre autorizado y previsualiza nombres anteriores/nuevos, descendientes afectados, firmantes y operaciones. Arrastrar un nodo puede abrir esa misma vista previa, pero no emite transacciones por sí solo. Estados: preparado, en movimiento, actualizando referencias, verificando, completado o requiere reconciliación. Se bloquean nuevas publicaciones mientras la migración no esté comprobada.

La operación debe:

1. Verificar propiedad y permisos en origen, destino, registro hijo y resolvers, además de disponibilidad, expiración y ausencia de ciclos. No sobrescribir una entrada ajena ni un destino ocupado.
2. Registrar o preparar la entrada destino apuntando al subregistro existente. Establecer el child pointer del destino y cambiar `setParent(nuevoPadre, etiqueta)` en el registro hijo. Comprobar ambos sentidos y la cadena canónica.
3. Migrar las referencias de los resolvers para los nuevos nombres completos. Cambiar pointers no renombra las claves internas del resolver: sus bundles se enlazan por nombre. El diseño para nuevos despliegues debe reservar `ROLE_LINK` exclusivamente a la autoridad de movilidad para `linkToNode`/`linkToRecord`, sin concedérselo a los agentes. Conservar el resolver mantiene los permisos por clave, incluidos los ya revocados; no ejecutar otra vez el provisioner para recuperarlos.
4. Actualizar el servicio ENS del ERC-8004 de cada agente con su wallet autorizada, manteniendo el mismo ID y propietario, y comprobar nuevamente ENSIP-25, contextos, referencias y manifiesto. La identidad estable del agente no debe depender del nombre completo, que ahora es mutable.
5. Desmontar la entrada anterior de acuerdo con una política explícita. Para el modo mover, el nombre anterior deja de ser una identidad canónica aceptada por Runtime. Un alias voluntario sería otro modo; no debe aparecer como una segunda identidad canónica. Conservar nombres, bloques y recibos antiguos en los expedientes históricos.
6. Confirmar la verificación completa y actualizar la ubicación activa en API. Persistir cada paso y reconciliar envíos ambiguos; un gesto en la UI no implica una sola transacción atómica entre todos estos contratos.

**Cambio obligatorio respecto al PR actual:** `nextProvisionStep` revoca `ROLE_SET_PARENT` y su admin en `lock-parent`; los resolvers se crean solo con administración de texto, sin `ROLE_LINK`. La API además fija `parentName`, `parentRegistry` y etiqueta como configuración/estado inmutables. Es necesario cambiar ese modelo antes del despliegue móvil, conservar únicamente los permisos de movilidad previstos y representar una migración autorizada en el estado persistido. No basta con añadir un botón ni eliminar las comprobaciones que hoy detectan cambios inesperados.

Una jerarquía ya creada con el parent bloqueado y sin autoridad capaz de restaurar el rol debe declararse **fija**. No prometer desbloquearla con una opción de interfaz: requeriría un flujo de migración a nuevos contratos. En esta revisión todavía no se han desplegado las identidades públicas, por lo que el modelo puede corregirse antes de hacerlo.

**Mover un agente individual también necesita soporte específico.** Hoy cada asiento es una entrada hoja, sin subregistro propio. Pasarlo a otro desk requiere crear su entrada de nombre en el registro destino, conservar o migrar su resolver y referencias, actualizar su asociación ENS y reconciliar el roster y la propiedad en API. No se puede aplicar `setParent` a una hoja ni afirmar que su token saltó entre contratos. La plantilla actual exige exactamente siete roles: no se debe dejar un desk con seis agentes operativos ni reemplazar silenciosamente al agente del destino. La UI debe distinguir movilidad de una rama de reorganización de asientos; esta última exige definir sustitución/asiento externo y el estado de ambos equipos.

## Brecha entre la base actual y este caso de uso

| Área | Base actual | Trabajo adicional |
| --- | --- | --- |
| Identidad | Siete asientos, resolvers independientes, ERC-8004 y verificación de ambos pointers | Aceptación pública con wallets Dynamic reales |
| Movilidad | Parent bloqueado, ubicación inmutable y agentes como hojas | Autoridad de movilidad, montaje destino, enlaces de records, actualización ENS de ERC-8004 y reconciliación |
| Publicación | Texto explícito del propietario firmado con la wallet del asiento | Publicación derivada de una contribución real del agente y ligada a la decisión |
| Descubrimiento | Estado autenticado de la instancia conocida por API | Manifiesto público versionado, publicado y descubierto desde el nombre ENS |
| Evidencia | Una clave mutable por asiento y recibos de operaciones | Paquetes identificables, hashes, referencias, vigencia y archivo verificable por decisión |
| Experiencia | Vista Identity independiente | Estados de evidencia dentro del turno, expediente y lector público |
| Orquestación | Analyze/advise usan Scout, Risk, Quote, Trader y Auditor; launch ya incluye Scout, Risk, Hooks, Treasury y Auditor | Conservar la procedencia real de cada resultado y distinguir los roles que no participan |

## Reglas técnicas que hacen creíble la demostración

**Origen real.** El endpoint existente acepta texto del propietario y firma desde la wallet del asiento. Eso no demuestra que el agente haya producido el texto. La nueva publicación debe derivarse de un resultado persistido y autorizado del trabajo real: instancia, `decisionId`, rol, agentId y contenido coincidentes. El propietario selecciona qué publicar, pero no puede presentar texto arbitrario como respuesta original del agente.

**Integridad e historial.** Definir una serialización canónica y una versión para cada paquete público, con identificación de decisión, identidad del autor, contenido, referencias y vigencia cuando corresponda. ENS almacena una referencia compacta dentro del límite actual de 1.024 bytes. El lector verifica el hash del contenido obtenido. Una clave ENS mutable no conserva por sí sola un archivo de decisiones: el expediente debe fijar hashes, transacciones y bloques para cada publicación.

**Actual e histórico.** Separar la identidad y permiso actuales de la procedencia de una publicación pasada. Para atribuir una contribución, comprobar también el firmante real de la transacción y su contenido; la presencia de un record no basta, porque el operador administra los resolvers. Una lectura histórica que necesite RPC de archivo y no esté disponible debe mostrarse como no comprobada.

**Descubrimiento.** El manifiesto público debe declarar versión, tipo de desk, asientos y referencias de evidencia. Requiere elegir y publicar su record y resolver del desk; esto no existe todavía en el planner actual. La aplicación debe comprobar cada identidad declarada y no interpretar URLs o texto de ENS como instrucciones o concesiones de acceso.

**Disponibilidad.** Un hash anclado no mantiene disponible el documento. El flujo debe definir alojamiento público persistente y permitir exportar el paquete. El lector no debe afirmar integridad de contenido que no pudo recuperar.

**Publicación deliberada.** No publicar prompts, conversaciones, credenciales o portafolios automáticamente. La vista previa define exactamente el paquete público. El registro de identidad vive en Sepolia; la red de los datos de mercado y la de una operación deben identificarse por separado.

## Criterios de aceptación

- Descubrir el manifiesto de un desk de ejemplo desde su ENS y verificar los siete asientos.
- Mover una rama entre padres del mismo propietario; conservar registro del equipo, agentes, wallets, IDs ERC-8004 y permisos vigentes, incluidas revocaciones.
- Verificar los siete nombres nuevos, sus records y ambos pointers; rechazar el nombre antiguo como identidad canónica activa.
- Interrumpir y reanudar una migración sin repetir transacciones confirmadas ni permitir publicación desde una ubicación a medio actualizar.
- Rechazar movimientos sin permisos, a nombres ocupados o padres caducados, hacia un descendiente que forme un ciclo y sobre ramas cuyo parent está bloqueado.
- Distinguir en la UI una rama móvil de una hoja que necesita reorganización de asientos; no presentar esta última como implementada hasta verificar los rosters de ambos desks.
- Producir al menos una decisión con aportes reales, identificados y estados honestos para los especialistas.
- Publicar una contribución desde su wallet Dynamic propia y conservar el recibo público de Sepolia.
- Comprobar el paquete desde otra sesión sin acceso a la base privada del propietario.
- Detectar una modificación de contenido, una contribución de otra decisión, un firmante incorrecto y una cotización caducada.
- Rechazar la escritura cruzada entre resolvers y mantener a Trader sin escritura ENS.
- Revocar un escritor, bloquear su nueva publicación y conservar la procedencia histórica del expediente anterior.
- Detectar una rama no canónica y bloquear nuevas publicaciones sin mostrar un estado de verificación positivo.

## Research y correcciones

Basado en Obsidian `ENS-V2/07-Use-Case-Brainstorm.md`, `08-Plan-Integracion.md` y la revisión `PerkOS-Runtime-ENS-V2-EQLTY-2026-09-26.md`. Se conservan el descubrimiento por nombre y la delegación visible como valor de producto. Se corrigen el supuesto de una transferencia completa mediante un solo token, el resolver compartido, el roster de cuatro agentes y la presunción de que la invitación por ENS ya existe.

Documentación oficial consultada para movilidad: [jerarquía](https://docs.ens.domains/ensv2/registry-hierarchy/), [parent pointer y roles](https://docs.ens.domains/ensv2/permissioned-registry/#parent-pointer), [bundles y linking de records](https://docs.ens.domains/ensv2/permissioned-resolver/#records-and-linking), y [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004). Las capacidades documentadas no sustituyen una prueba de migración con la versión de contratos fijada para Sepolia. La suite actual no verifica este flujo completo.

## Secuencia de implementación autorizada

1. SDK: jerarquías móviles, manifiesto público en el resolver del desk, enlaces de bundles, conservación de grants y metadatos ERC-8004; pruebas con contratos oficiales en fork.
2. API: migración persistida con los mismos locks de firma y reconciliación; captura protegida del resultado real de tareas, vista previa y publicación por hash.
3. Runtime: expediente desde History, exportación y verificador público; previsualización y reanudación de movilidad desde Identity.
4. Verificación de contratos, suites y build; PR nuevo de Runtime sobre main y actualización de los PRs dependientes. Activación pública requiere el operador Dynamic y permisos reales del padre.

Los padres de origen y destino deben tener el mismo propietario en ENS y estar en la lista de padres permitidos del despliegue. La propiedad de la entrada del desk permanece idéntica. El operador debe poder registrar en destino y desmontar el child pointer de origen; una falta de autoridad bloquea el inicio antes de firmar. Los registros ya bloqueados permanecen fijos.
