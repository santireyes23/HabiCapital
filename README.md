# HabiCapital

HabiCapital es una billetera digital que desarrollé para el reto técnico de practicantes de
HabiCapital. Permite crear una cuenta, recargar saldo, enviar dinero a otras cuentas, consultar los
movimientos y pedirle dinero a otra persona mediante solicitudes. Todo funciona con **dinero
simulado** en pesos colombianos: no se conecta a bancos ni realiza pagos reales.

El backend está hecho con **Python, FastAPI y PostgreSQL**, y la interfaz web con **React y
TypeScript**.

**Video de la demo:** https://youtu.be/c6nUBjfy_ZI

## Cómo ejecutarlo

Solo necesitas tener instalados [uv](https://docs.astral.sh/uv/), [Node.js](https://nodejs.org/)
(22.12 o superior) y [Docker Desktop](https://www.docker.com/products/docker-desktop/).

**1. Backend y base de datos.** En una terminal, dentro de la carpeta del proyecto:

```bash
copy .env.example .env
uv sync
docker compose up -d db
uv run alembic upgrade head
uv run uvicorn habicapital.main:app --reload
```

**2. Interfaz web.** En otra terminal:

```bash
cd frontend
npm ci
npm run dev
```

**3. Listo.** Abre http://127.0.0.1:5173, crea una cuenta y **guarda tu token de acceso**: es la
única forma de volver a entrar y solo se muestra una vez. Si tienes dudas, la aplicación tiene un
Centro de ayuda en `/ayuda`.

<details>
<summary>¿Sin Docker? Con PostgreSQL 18 instalado en el sistema</summary>

Omite `docker compose up -d db` y crea una vez el usuario y las dos bases con `psql -U postgres`:

```sql
CREATE ROLE habicapital LOGIN PASSWORD 'habicapital';
CREATE DATABASE habicapital OWNER habicapital;
CREATE DATABASE habicapital_test OWNER habicapital;
```

Los valores de `.env.example` son de prueba, solo para trabajar en local.
</details>

## Pruebas

Durante el desarrollo escribí pruebas automatizadas para comprobar que todo funciona y, sobre todo,
que no se pierde dinero. Están divididas en tres partes:

| Qué prueba | Cómo ejecutarlo |
|---|---|
| **Backend** (330 pruebas): cuentas, recargas, transferencias, movimientos y solicitudes, incluidos los errores de conexión, las operaciones simultáneas y los fallos a mitad de una transferencia. | `uv run pytest` |
| **Interfaz web** (403 pruebas): cada pantalla, los formularios, los mensajes de error y los reintentos cuando una operación queda sin confirmar. | `cd frontend` y `npm test` |
| **De extremo a extremo** (Playwright): usan la aplicación completa en un navegador real, con FastAPI y PostgreSQL. Revisan los flujos de dinero, la accesibilidad, que se vea bien en móvil y la seguridad del token. | `cd frontend`, `npx playwright install chromium` (solo la primera vez) y `npm run test:e2e` |

Las pruebas del backend y las de extremo a extremo usan la base `habicapital_test`, así que nunca
tocan los datos de la base de desarrollo.

Además, cada vez que subo cambios a GitHub, **GitHub Actions** ejecuta automáticamente las tres
partes. Así puedo comprobar que un cambio no rompe nada antes de darlo por terminado.

## Respuestas del reto

### 1. Las decisiones clave y por qué las tomé

Una de las primeras decisiones que tomé fue utilizar **Python con FastAPI** para desarrollar el backend. Elegí esta tecnología por recomendación de un amigo, ya que anteriormente no había trabajado con ella. Aunque al principio representó un reto, lo vi como una oportunidad para aprender algo nuevo y familiarizarme con el desarrollo de APIs.

Otra decisión importante fue crear una **interfaz web completa**, aunque el reto no la exigía explícitamente. Quería que HabiCapital fuera fácil de utilizar y que las personas pudieran realizar operaciones sin necesidad de interactuar directamente con los endpoints. Además, aproveché esta oportunidad para retomar y reforzar mis conocimientos de desarrollo web, especialmente CSS.

Como funcionalidad adicional decidí implementar **solicitudes de dinero entre usuarios**. Quería ofrecer algo diferente a las operaciones básicas de una billetera digital. Me pareció interesante porque no es una función que haya visto frecuentemente en las aplicaciones bancarias que conozco. Además, puede resultar útil en situaciones cotidianas, como dividir gastos entre amigos o solicitar pagos pendientes.

En cuanto a la seguridad y el manejo del dinero, me apoyé en Claude Code. La IA me propuso utilizar PostgreSQL, contabilidad de doble partida e idempotencia para proteger las operaciones. Como varios de estos conceptos eran nuevos para mí, le pedía explicaciones antes de aprobar su implementación, buscando comprender qué problema resolvía cada mecanismo.

Elegí **PostgreSQL** porque sus transacciones garantizan que una operación se guarde completa o no se guarde nada, y porque permite bloquear filas con `SELECT ... FOR UPDATE` mientras se modifica un saldo. Además, las reglas más importantes también viven en la propia base de datos: restricciones `CHECK` impiden que el saldo de un usuario quede negativo y un *trigger* impide modificar una solicitud que ya fue aceptada, rechazada o cancelada. Así, aunque el código tuviera un error, la base de datos rechazaría el cambio. Por la misma razón, los montos se guardan como enteros de pesos (`BIGINT`) y la API rechaza valores como `100.5` o `"100"`, para evitar errores de redondeo.

El dinero se registra con un **ledger de doble partida**: cada operación crea una transacción en `ledger_transactions` con al menos dos asientos en `ledger_entries` que suman cero. Una recarga, por ejemplo, descuenta de una cuenta interna del sistema (FUNDING) y acredita al usuario, de modo que la suma de todos los saldos siempre es cero y cualquier peso que aparezca o desaparezca se puede detectar.

Para el acceso usé **tokens Bearer**: al crear la cuenta se genera un token aleatorio de 256 bits (`secrets.token_urlsafe(32)`) y en la base de datos solo se guarda su hash SHA-256, nunca el token en claro. Las rutas propias van en `/accounts/me/...`, así que la cuenta se deduce del token y nadie puede operar sobre otra cuenta cambiando un id en la petición.

En las solicitudes de dinero decidí no crear una segunda forma de mover plata: al aceptar una solicitud (`POST /money-requests/{id}/accept`) se llama a la misma función de transferencia que usa `POST /accounts/me/transfers`, y el cambio de estado, los asientos y el registro de idempotencia se confirman en un único `COMMIT`. Así hay un solo lugar donde el dinero cambia de cuenta, y las protecciones y pruebas de las transferencias también cubren las solicitudes.

En la interfaz web usé **React con TypeScript** y Vite. El navegador llama a la API a través de un proxy en el mismo origen (`/api`), lo que permite una política de seguridad de contenido (CSP) estricta sin scripts externos. El token se guarda en `sessionStorage`, nunca en `localStorage`, para que se borre al cerrar la pestaña.

En general, busqué que el proyecto no solo cumpliera los requisitos del reto, sino que también fuera una aplicación fácil de usar y que me permitiera aprender nuevas tecnologías.

### 2. Cómo sé que mi sistema no pierde un peso

Para comprobar que HabiCapital no pierde dinero, me apoyé en diferentes pruebas automatizadas que verifican cuatro mecanismos principales: la idempotencia, la contabilidad de doble partida, la atomicidad y el control de concurrencia.

La **idempotencia** evita que una misma operación se ejecute dos veces cuando ocurre un problema de conexión y el usuario vuelve a intentarla. La **contabilidad de doble partida** permite comprobar que cada peso que sale de una cuenta llega a otra y que los registros contables permanecen equilibrados.

Por otra parte, la **atomicidad** garantiza que una operación se complete totalmente o que sus cambios se deshagan si ocurre un error. Finalmente, el **control de concurrencia** evita que varias transferencias simultáneas utilicen incorrectamente el mismo saldo.

Para verificar estas protecciones, se realizaron pruebas que simulan errores de conexión, operaciones simultáneas y fallos durante las transferencias. Por ejemplo, una prueba ejecuta diez transferencias de $1.000 desde una cuenta con $5.000: cinco se completan y cinco se rechazan por saldo insuficiente, sin que el dinero se pierda ni el saldo quede negativo.

También se implementaron pruebas de extremo a extremo con Playwright, FastAPI y PostgreSQL para comprobar el comportamiento del sistema completo, incluyendo escenarios en los que una operación se procesa, pero la respuesta no llega al navegador.

En concreto, la idempotencia funciona con la cabecera `Idempotency-Key`, obligatoria en recargas, transferencias, creación de solicitudes y pagos. La respuesta se guarda en `idempotency_records` dentro del mismo `COMMIT` que mueve el dinero; si llega otra petición con la misma clave, el servidor devuelve la respuesta original con `Idempotent-Replayed: true` sin volver a cobrar, y si la clave se reutiliza con otro contenido responde `422`. La concurrencia se controla bloqueando las cuentas con `SELECT ... FOR UPDATE` siempre en orden ascendente de id, para que dos transferencias cruzadas no se bloqueen mutuamente (*deadlock*).

El backend tiene 330 pruebas automatizadas con pytest sobre una base PostgreSQL real (`habicapital_test`). Después de cada escenario se comprueban directamente en la base de datos estas invariantes: la suma de todos los saldos es cero, cada transacción tiene asientos que suman cero, cada saldo es igual a la suma de sus asientos y ninguna cuenta de usuario queda en negativo. Algunas pruebas lanzan 30 recargas simultáneas, 30 transferencias cruzadas entre dos cuentas o 10 aceptaciones simultáneas de la misma solicitud, y comprueban que no se pierde ni se duplica dinero (en el caso de las 10 aceptaciones, solo una se cobra).

También se hicieron **pruebas de mutación**: se introdujeron errores a propósito en el código para comprobar que las pruebas los detectaban. Por ejemplo, al quitar el `FOR UPDATE` fallaron las tres pruebas de concurrencia, y al bloquear las cuentas en otro orden PostgreSQL registró 16 *deadlocks* (cero con el código correcto). En el frontend, cuando una operación queda sin respuesta, se guarda con su misma `Idempotency-Key` y solo se reintenta de forma manual con esa clave. Por último, GitHub Actions ejecuta en cada cambio tres trabajos: Ruff, mypy y pytest para el backend; ESLint, TypeScript, 403 pruebas de Vitest y el build para el frontend; y las pruebas de extremo a extremo con Playwright.

Por eso considero que tengo evidencia sólida de que HabiCapital mantiene la consistencia del dinero en los escenarios evaluados, aunque reconozco que las pruebas no garantizan la ausencia absoluta de errores.

### 3. Qué dejé fuera y por qué

Durante el desarrollo de HabiCapital decidí concentrarme principalmente en cumplir los requisitos del reto y asegurarme de que cada funcionalidad estuviera implementada correctamente.

Aunque existían varias posibilidades para ampliar el proyecto, preferí enfocarme en las operaciones principales, como crear cuentas, recargar saldo, realizar transferencias y consultar movimientos, además de implementar las solicitudes de dinero como funcionalidad adicional.

Por cuestiones de tiempo, dejé fuera algunas características que podrían mejorar la aplicación, como las notificaciones, la recuperación de cuentas cuando se pierde el token de acceso y otras funciones más avanzadas.

Algunas limitaciones las dejé documentadas a propósito:

- Las solicitudes de dinero no vencen: no existe un estado `EXPIRED`.
- Los tokens no expiran (solo se invalidan al regenerarlos) y cada cuenta tiene un único token.
- No hay límite de peticiones (*rate limiting*) ni bloqueo por intentos fallidos.
- El historial se pagina con `limit` y `offset`: si llegan movimientos nuevos mientras se recorren las páginas, alguno puede repetirse. Una paginación por cursor lo evitaría.
- Crear una cuenta no es idempotente: si se pierde la respuesta de `POST /accounts` y se reintenta, se crea otra cuenta. No lo resolví porque exigiría guardar el token para poder repetir la respuesta, y preferí no guardarlo nunca.
- Todas las recargas bloquean la misma cuenta interna (FUNDING), así que se procesan de una en una. Para este alcance es suficiente, pero a gran escala sería un cuello de botella.

Ninguna de estas limitaciones hace que se pierda dinero, pero resolverlas requería más cambios en el backend de los que podía probar bien en el tiempo del reto.

Consideré que era más importante entregar un sistema funcional, con una interfaz fácil de utilizar y pruebas que respaldaran la seguridad de sus operaciones, en lugar de agregar más características sin poder comprobar adecuadamente su funcionamiento.

Mi prioridad fue desarrollar de la mejor manera posible lo que pedía el reto, manteniendo un alcance que pudiera manejar durante el tiempo disponible.

### 4. Qué haría distinto con más tiempo

Si hubiera tenido más tiempo, me habría gustado explorar la posibilidad de integrar operaciones con dinero real, empezando por estudiar una implementación sencilla y controlada. Aunque HabiCapital funciona actualmente con dinero simulado, considero interesante investigar cómo podría evolucionar hacia una aplicación financiera real, teniendo en cuenta los requisitos adicionales de seguridad, regulación e integración con servicios de pago.

También me habría gustado implementar una funcionalidad para **dividir cuentas entre varias personas**, algo que considero especialmente útil cuando un grupo de amigos comparte gastos, como una cena o un viaje. Esta función complementaría las solicitudes de dinero que ya desarrollé.

Otra mejora que habría explorado es un **resumen de movimientos**, en el que cada usuario pudiera consultar cuánto dinero ha enviado y recibido durante un período, identificar sus transferencias más frecuentes y visualizar esa información mediante gráficos sencillos.

En la parte técnica, también revisaría las limitaciones que dejé documentadas: añadiría expiración a los tokens, un límite de peticiones para evitar abusos y un estado `EXPIRED` para que las solicitudes pendientes venzan; cambiaría la paginación del historial a una paginación por cursor; evaluaría guardar la sesión en una cookie `HttpOnly` en lugar de `sessionStorage`, aunque eso implicaría cambiar la autenticación del backend; y ejecutaría las pruebas de extremo a extremo también en Firefox y Safari, porque ahora solo se ejecutan en Chromium.

En general, con más tiempo habría buscado ampliar las funcionalidades de HabiCapital sin descuidar la seguridad, la facilidad de uso y la estabilidad del sistema.

### 5. Qué NO sé

Una de las cosas que reconozco es que todavía tengo mucho por aprender sobre el desarrollo de aplicaciones completas, especialmente en el backend. Antes de comenzar este reto no tenía experiencia con FastAPI y tampoco conocía en profundidad conceptos como la idempotencia, la contabilidad de doble partida y el manejo de operaciones concurrentes.

Aunque durante el desarrollo pude familiarizarme con estos conceptos y comprender mejor para qué sirven, todavía no considero que los domine completamente. Si tuviera que construir una aplicación similar desde cero, necesitaría bastante apoyo de herramientas de inteligencia artificial, documentación y ejemplos prácticos.

También soy consciente de que me falta experiencia para tomar por mi cuenta ciertas decisiones relacionadas con la arquitectura, la seguridad y el funcionamiento de sistemas financieros.

Sin embargo, considero que reconocer estas limitaciones es parte de mi proceso de aprendizaje. Este reto me permitió acercarme a tecnologías que no conocía, hacer preguntas y comprender mejor la importancia de probar las soluciones antes de darlas por terminadas.

Mi objetivo es seguir fortaleciendo mis conocimientos para depender cada vez menos de la IA en las decisiones que pueda resolver por mi cuenta y utilizarla cada vez mejor como herramienta de apoyo.

### 6. Los supuestos que hice y por qué

Cuando leí el reto por primera vez, supuse que desarrollar una billetera con dinero simulado sería un proyecto relativamente sencillo y corto. Sin embargo, a medida que avancé, descubrí que había muchos más aspectos que considerar de los que imaginaba inicialmente, especialmente cuando se trataba de garantizar que las operaciones fueran correctas y que no se perdiera dinero.

Desde el principio tuve claro que el sistema manejaría dinero simulado, por lo que asumí que no sería necesario integrar bancos, pasarelas de pago ni realizar operaciones con dinero real. Esto me permitió concentrarme en desarrollar correctamente las funcionalidades principales.

También trabajé bajo el supuesto de que se trataba de una aplicación de demostración con un alcance limitado, por lo que no era necesario implementar todas las características de una plataforma financiera comercial, como la verificación de identidad o un sistema avanzado de autenticación. En su lugar, utilicé un mecanismo de acceso mediante tokens.

Otra decisión fue manejar los montos en pesos colombianos enteros, sin decimales, y establecer límites para las operaciones. Esto permitió simplificar el manejo de las cantidades y evitar problemas relacionados con cálculos monetarios.

Otros supuestos técnicos que tomé:

- Cada cuenta empieza con $0 y tiene un único token. Las cuentas se identifican con UUID aleatorios, y para recibir dinero basta con compartir ese UUID.
- Cada operación debe ser un entero entre $1 y $10.000.000. El mismo tope se aplica a las solicitudes, para no crear solicitudes que luego no se puedan aceptar.
- Las recargas simuladas salen de una cuenta interna del sistema (FUNDING) que queda en negativo, para que cada peso que aparece en una cuenta tenga un origen registrado y la suma total de saldos siempre sea cero.
- Si alguien intenta ver o actuar sobre una solicitud ajena, la API responde `404` en lugar de `403`, para no confirmar que esa solicitud existe.
- Al crear una solicitud no se revisa el saldo de quien debe pagar, porque eso le revelaría su saldo a otra persona; el saldo se comprueba solo cuando decide aceptarla.

Este proyecto me enseñó que incluso una aplicación que parece sencilla puede tener una complejidad considerable cuando se busca que funcione correctamente. También comprendí que es importante identificar los supuestos desde el principio, porque estos influyen directamente en las decisiones que se toman durante el desarrollo.

### 7. Cómo utilicé la inteligencia artificial

La inteligencia artificial tuvo un papel muy importante durante el desarrollo de HabiCapital. Utilicé principalmente Claude Code y ChatGPT, además de Google Stitch y Figma para trabajar en el diseño de la interfaz.

Mi dinámica consistía en utilizar ChatGPT para analizar ideas, organizar las etapas del proyecto y comprender las propuestas técnicas. Después utilizaba Claude Code para implementar las funcionalidades, configurar las herramientas, escribir pruebas y corregir errores.

Como varias tecnologías eran nuevas para mí, procuraba pedir explicaciones antes de aprobar las propuestas. Por ejemplo, Claude me recomendó utilizar contabilidad de doble partida, idempotencia y mecanismos de concurrencia para proteger las operaciones. Aunque inicialmente no conocía estos conceptos, fui comprendiendo su propósito durante el desarrollo.

Para la interfaz utilicé **Google Stitch**, que me permitió generar los diseños iniciales de las pantallas. Posteriormente trabajé con **Figma** para organizarlos y utilizarlos como referencia, mientras Claude Code se encargaba de implementarlos en React, TypeScript y CSS.

Aunque la IA propuso e implementó gran parte de las soluciones técnicas, yo participé definiendo el alcance, seleccionando la funcionalidad adicional, tomando decisiones sobre la experiencia de usuario y aprobando las diferentes etapas.

También comprobé que la IA puede cometer errores. Durante una auditoría se descubrió que una respuesta tardía del servidor podía actualizar el saldo de una cuenta después de cambiar de sesión, mostrando información incorrecta. Claude tuvo que corregir ese comportamiento y añadir verificaciones para evitar que volviera a ocurrir.

No fue el único caso. Al optimizar la interfaz, las pantallas pasaron a cargarse de forma diferida (`React.lazy`), y una prueba de Vitest escrita por la IA buscaba el nuevo saldo antes de que terminara de cargar Inicio: encontraba el texto en la pantalla anterior, que desaparecía un instante después. Pasaba en mi computador, pero falló en GitHub Actions (CI #12); la corregimos para que esperara a la pantalla correcta y el CI volvió a pasar. Y al revisar el video de la demo, la IA me dijo que no se veía cómo se aceptaba una solicitud. Yo sabía que sí aparecía, se lo indiqué y, al revisar el video con más detalle, comprobó que estaba equivocada.

Esta experiencia me enseñó que la IA es una herramienta muy útil para desarrollar proyectos complejos, especialmente cuando todavía estoy aprendiendo, pero que sus resultados deben revisarse y comprobarse mediante pruebas. También entendí la importancia de hacer preguntas y no aceptar automáticamente todas sus recomendaciones.

### 8. Qué aprendí

Durante el desarrollo de HabiCapital aprendí muchas cosas que no conocía y reforcé algunos conocimientos que ya tenía.

Uno de los descubrimientos que más me llamó la atención fue el uso de las conexiones **MCP (Model Context Protocol)**. Antes de comenzar el proyecto no conocía estas herramientas y me sorprendió cómo permiten conectar la inteligencia artificial con otros servicios y facilitar diferentes tareas del desarrollo. Herramientas como Serena, Context7 y la integración con Figma fueron de gran ayuda durante el proceso.

También aprendí sobre el funcionamiento de las **API**, especialmente utilizando FastAPI. Aunque todavía me falta bastante por aprender, ahora comprendo mejor cómo se comunica una interfaz con un servidor, cómo se organizan los endpoints y cómo se conecta una aplicación con una base de datos.

Otro aprendizaje importante fue conocer mejor **GitHub y GitHub Actions**. Antes no estaba familiarizado con muchas de estas herramientas y me pareció interesante descubrir cómo se pueden automatizar las pruebas para comprobar que los cambios del proyecto funcionan correctamente.

Sin embargo, lo que más me sorprendió fue descubrir **lo complejo que puede llegar a ser un sistema financiero**, incluso cuando utiliza dinero simulado. Al principio imaginaba que el reto sería mucho más sencillo, pero durante el desarrollo comprendí que hay muchos aspectos que deben considerarse para evitar errores, como las operaciones duplicadas, los problemas de conexión y las transferencias simultáneas. Esto me hizo pensar en la enorme complejidad que debe tener construir un sistema financiero real desde cero y a gran escala.

También aprendí el valor de las pruebas automáticas en la práctica: algunos errores no se notaban usando la aplicación, sino que aparecieron porque una prueba falló, ya fuera en mi computador o en GitHub Actions.

Me llevo de esta experiencia nuevos conocimientos técnicos, una mejor comprensión de cómo se desarrolla una aplicación completa y, sobre todo, la importancia de seguir aprendiendo, hacer preguntas y comprobar que las soluciones realmente funcionan. También descubrí lo útil que puede ser la inteligencia artificial cuando se utiliza como una herramienta de apoyo para aprender y desarrollar proyectos.

## Más detalles

Si quieres conocer la parte técnica con más profundidad (cómo se protege el dinero, la seguridad,
la arquitectura, las limitaciones y la matriz de requisitos del reto), está en
[docs/detalles-tecnicos.md](docs/detalles-tecnicos.md). Los detalles de la interfaz web están en
[frontend/README.md](frontend/README.md).
