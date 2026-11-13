# HabiCapital: billetera P2P

HabiCapital es una billetera digital para que un grupo de personas se mueva plata entre sí sin
pasar por el banco, guardando el contexto de cada movimiento: el cumpleaños, el arriendo, la
parte de la cena que alguien te pide.

**Objetivo:** resolver el reto técnico de HabiCapital (Practicantes 2027). El núcleo es crear
cuentas, cargar saldo simulado, transferir, consultar saldo y ver el historial, más una
funcionalidad adicional, bajo una regla que no se negocia: **el sistema no puede perder un
peso**. Como funcionalidad adicional elegí las **solicitudes de dinero entre usuarios** («págame
mi parte»), que cubren los escenarios del reto en los que alguien tiene que cobrarle a otros.

Todo el dinero es **simulado**: no hay pasarela de pagos ni dinero real.

## Contenido

- [Estado de verificación](#estado-de-verificación)
- [Requisitos del reto](#requisitos-del-reto)
- [Arquitectura](#arquitectura)
- [Funcionalidades](#funcionalidades)
- [Tecnologías](#tecnologías)
- [Cómo ejecutarlo](#cómo-ejecutarlo)
- [Pruebas](#pruebas)
- [Cómo no se pierde un peso](#cómo-no-se-pierde-un-peso)
- [Seguridad](#seguridad-autenticación-y-autorización)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Respuestas del reto](#respuestas-del-reto)

## Estado de verificación

| Parte | Implementado | Verificado |
|---|---|---|
| Etapa 0 del backend: estructura, tooling, CI | Sí | Sí: local y en GitHub Actions. |
| Etapa 1 del backend: identidad (cuentas y tokens) | Sí | Sí: PostgreSQL 18 local y en CI. |
| Etapa 2 del backend: saldo, ledger de doble partida, cuenta FUNDING, depósitos idempotentes | Sí | Sí: PostgreSQL 18 local y en CI (incluye concurrencia y fallo a mitad de operación). |
| Etapa 3 del backend: transferencias entre usuarios | Sí | Sí: PostgreSQL 18 local y en CI (incluye concurrencia, idempotencia y fallo a mitad de operación). |
| Etapa 4 del backend: historial de movimientos | Sí | Sí: PostgreSQL 18 local y en CI (incluye aislamiento entre cuentas, paginación y lecturas concurrentes). |
| Etapa 5 del backend: solicitudes de dinero | Sí | Sí: PostgreSQL 18 local y en CI (incluye permisos, idempotencia, atomicidad, concurrencia y protección de estados finales en la BD). |
| Frontend web (ocho pantallas, incluido el Centro de ayuda) | Sí | Sí: local y en GitHub Actions (último: CI #13): 403 pruebas (Vitest) y pruebas E2E (Playwright) contra FastAPI y PostgreSQL reales, con accesibilidad, responsive y seguridad. |

**Integración continua** (las etapas son las de la tabla anterior; desde el CI #9 también se ejecutan los jobs `frontend` y `e2e`). Estas son las ejecuciones de GitHub Actions que registré, todas con PostgreSQL 18 como servicio:

| Ejecución | Commit | Cubre | pytest |
|---|---|---|---|
| CI #1 | `45adf5c` | Etapas 0–2 | 77 de 77 aprobadas |
| CI #2 | `5e27c55` | Etapas 0–2 | 77 de 77 aprobadas |
| CI #3 | `406a471` | Etapas 0–3 | **117 de 117 aprobadas** |
| CI #4 | `9869515` | Etapas 0–3 | 117 de 117 aprobadas |
| CI #5 | `8104660` | Etapas 0–4 | **144 de 144 aprobadas, 0 omitidas** |
| CI #6 | `0c2d16b` | Etapas 0–4 (solo cambió el README) | 144 de 144 aprobadas, 0 omitidas |
| CI #7 | `d16ff67` | Etapas 0–5 | **330 de 330 aprobadas, 0 omitidas** |
| CI #9 | `9c46da7` | Etapas 0–5 + frontend web (primer CI con los jobs `frontend` y `e2e`) | 330 de 330 aprobadas, 0 omitidas; además Vitest 393 de 393 y Playwright 39 aprobadas, 3 omitidas a propósito |
| CI #13 | `5186e4c` | Etapas 0–5 + frontend web con Centro de ayuda | Backend, frontend y E2E aprobados; duración total 3 min 9 s |

En cada ejecución, Ruff (formato y lint) y mypy estricto (`src`, `tests`, `migrations`) pasaron
sin errores, y las migraciones Alembic (`upgrade head`) se aplicaron. Ninguna prueba se saltó:
el CI usa `HABICAPITAL_REQUIRE_DB=1`, que hace fallar en lugar de saltar las que necesitan BD.
Además, en local pasaron las 330 pruebas con `HABICAPITAL_REQUIRE_DB=1` y las migraciones desde
cero y con downgrade (el CI solo aplica `upgrade head`).

En el CI #9 y en el CI #13 los tres jobs (`checks`, `frontend` y `e2e`) terminaron correctamente; los recuentos del CI #9 son los de ese commit, verificado también en local. No todas las ejecuciones fueron verdes: el CI #12 falló en el job `frontend` por una prueba de Vitest inestable (esperaba un texto antes de que terminara de cargar Inicio). La corregí en `5186e4c`, cuya ejecución es el CI #13.

"Verificado" significa que la suite pasa en mi máquina y en el CI.

## Requisitos del reto

Cada fila enlaza la funcionalidad con su endpoint, su pantalla y las pruebas que la demuestran.
"Cumplido" exige evidencia automatizada; lo que depende de una entrega manual queda marcado como
pendiente.

| # | Requisito | Implementación | Endpoint | Pantalla | Evidencia | Estado |
|---|---|---|---|---|---|---|
| 01 | Crear una cuenta (un usuario con saldo) | Cuenta con saldo inicial 0 y token Bearer que se muestra una sola vez | `POST /accounts` | Acceso → «Crear cuenta» | `tests/test_accounts_api.py`; `frontend/src/pages/access/register.test.tsx`; E2E `accounts.spec.ts` | Cumplido |
| 02 | Cargar saldo (simulado) | Depósito de 1 a 10.000.000 COP contra la cuenta de sistema FUNDING, idempotente | `POST /accounts/me/deposits` | Recargar saldo | `tests/test_deposits.py` (17); `topup.test.tsx`; E2E `money.spec.ts` (incluye corte de red y reintento) | Cumplido |
| 03 | Transferir saldo entre cuentas | Transferencia atómica de doble partida, con bloqueo ordenado e idempotencia | `POST /accounts/me/transfers` | Enviar dinero | `tests/test_transfers.py` (21, con concurrencia y mutaciones); `send.test.tsx`; E2E `money.spec.ts` | Cumplido |
| 04 | Consultar saldo en cualquier momento | Saldo leído del backend (nunca calculado en el navegador) | `GET /accounts/me` | Inicio; también en Mi cuenta, Movimientos, Recargar y Enviar | `tests/test_accounts_api.py`; `home.test.tsx`; E2E: saldos verificados contra la API tras cada operación | Cumplido |
| 05 | Ver historial de movimientos | Movimientos paginados con tipo, signo, contraparte y saldo posterior | `GET /accounts/me/movements` | Movimientos (y «Movimientos recientes» en Inicio) | `tests/test_movements.py` (17, con conciliación); `movements.test.tsx`; E2E `money.spec.ts` | Cumplido |
| — | Funcionalidad adicional | Solicitudes de dinero: crear, aceptar (paga con la misma transferencia del ledger), rechazar y cancelar | `/money-requests` (6 endpoints) | Solicitudes de dinero (y tarjetas en Inicio) | `tests/test_money_request*.py` (95); `requests.test.tsx` (70); E2E `requests.spec.ts` | Cumplido |
| — | No perder un peso | Enteros, doble partida, transacción única, bloqueos, idempotencia, `CHECK` y trigger en la BD | Todos los que mueven dinero | Recuperación de resultados inciertos con la misma clave en cada operación | Invariantes del ledger tras cada escenario de pytest y al final de las E2E (`frontend/e2e/backend.py check`); pruebas de concurrencia y de mutación | Cumplido (evidencia en [Cómo no se pierde un peso](#cómo-no-se-pierde-un-peso)) |
| — | Entregable: repositorio público en GitHub | Repositorio `santireyes23/HabiCapital` | — | — | — | **Pendiente:** confirmar la visibilidad pública al entregar |
| — | Entregable: README en primera persona con los ocho puntos | Este documento | — | — | — | Cumplido: [Respuestas del reto](#respuestas-del-reto) |
| — | Entregable: video de máximo 5 minutos | Demo grabada (3 min 45 s): [youtu.be/RJTPof1fv3M](https://youtu.be/RJTPof1fv3M) | — | — | — | Cumplido |

## Arquitectura

```
Navegador (React SPA)  ──/api/...──►  Vite (proxy, CSP)  ──►  FastAPI  ──►  PostgreSQL 18
   frontend/                            frontend/config        src/habicapital   migraciones Alembic
```

- **Backend (`src/habicapital`)**: FastAPI organizado por dominio. `accounts` (cuentas, tokens,
  autenticación), `ledger` (depósitos, transferencias e historial sobre un ledger de doble
  partida), `money_requests` (solicitudes) e `idempotency` (registro de respuestas por
  `Idempotency-Key`). Los errores de negocio se traducen a HTTP en un solo lugar (`errors.py`).
- **Base de datos**: PostgreSQL 18 con SQLAlchemy 2 y migraciones Alembic. Las reglas críticas
  también viven en la BD (`CHECK`, unicidad y un trigger para los estados finales).
- **Frontend (`frontend/`)**: SPA en React y TypeScript. Llama a la API en `/api` a través del
  proxy de Vite, así que todo sale del mismo origen (sin CORS y con `connect-src 'self'` en la
  CSP). Detalle en [`frontend/README.md`](frontend/README.md).
- **CI (`.github/workflows/ci.yml`)**: tres jobs. `checks` (Ruff, mypy, migraciones y pytest
  con PostgreSQL), `frontend` (ESLint, TypeScript, Vitest y build) y `e2e` (Playwright contra
  FastAPI y PostgreSQL reales, después de los dos anteriores).

## Funcionalidades

| Función | API | Interfaz |
|---|---|---|
| Crear cuenta y recibir el token | `POST /accounts` | Acceso → «Crear cuenta», con confirmación de que el token se guardó |
| Entrar con un token | `GET /accounts/me` | Acceso → «Ya tengo cuenta» |
| Consultar la cuenta y el saldo | `GET /accounts/me` | Inicio, Mi cuenta |
| Regenerar el token | `POST /accounts/me/token` | Mi cuenta |
| Cargar saldo simulado | `POST /accounts/me/deposits` | Recargar saldo |
| Transferir a otra cuenta por su UUID | `POST /accounts/me/transfers` | Enviar dinero |
| Historial de movimientos | `GET /accounts/me/movements` | Movimientos, Inicio |
| Solicitudes de dinero | `/money-requests` | Solicitudes de dinero, Inicio |
| Estado del servidor | `GET /health` | Indicador «Servidor FastAPI conectado» en Inicio |
| Centro de ayuda | — | Ruta pública `/ayuda`, con o sin sesión: 17 preguntas frecuentes en cuatro categorías, en acordeones accesibles. Se abre desde la pantalla de acceso («¿Necesitas ayuda?»), el menú lateral y el menú móvil («Ayuda») |

La documentación interactiva de la API está en `http://localhost:8000/docs` con el backend en
marcha.

## Tecnologías

| Parte | Stack |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 18 · Pydantic Settings · uv |
| Calidad del backend | pytest · httpx · Ruff · mypy estricto |
| Frontend | React 19 · TypeScript 6 (estricto) · Vite 8 · Tailwind CSS 4 · React Router 8 · Manrope autoalojada |
| Calidad del frontend | Vitest 5 + Testing Library · ESLint (typescript-eslint estricto) · Playwright · axe-core |
| Infraestructura | Docker Compose (PostgreSQL) · GitHub Actions |

## Cómo ejecutarlo

Requisitos: [uv](https://docs.astral.sh/uv/), Node.js 22.12 o superior (verificado con 24) y
PostgreSQL 18 (con Docker Desktop o instalado en el sistema). Los comandos están probados en
Windows.

### 1. Configuración y base de datos

```bash
copy .env.example .env                          # configuración local (obligatoria; edítala)
uv sync                                         # dependencias (instala Python 3.12 si falta)
docker compose up -d db                         # PostgreSQL 18 (crea habicapital y habicapital_test)
uv run alembic upgrade head                     # migraciones sobre la base de desarrollo
```

**Sin Docker (PostgreSQL 18 instalado en Windows):** se omite `docker compose`. Hay que crear una
vez el usuario y las dos bases que Compose crearía. Con `psql -U postgres`:

```sql
CREATE ROLE habicapital LOGIN PASSWORD 'habicapital';
CREATE DATABASE habicapital OWNER habicapital;
CREATE DATABASE habicapital_test OWNER habicapital;
```

### 2. Variables de entorno

Todas van en `.env` (ignorado por git) o en el entorno. `.env.example` trae valores ficticios.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `HABICAPITAL_DATABASE_URL` | Sí | Base de desarrollo (`habicapital`): la usan la API y Alembic. Sin ella la API no arranca. |
| `HABICAPITAL_TEST_DATABASE_URL` | No | Base de pruebas (`habicapital_test`): la usan solo pytest y las E2E. Por defecto, las credenciales ficticias de desarrollo. |
| `HABICAPITAL_DATABASE_CONNECT_TIMEOUT` | No | Segundos para abrir una conexión (5 por defecto). |
| `HABICAPITAL_REQUIRE_DB` | No | `1` hace fallar (en vez de saltar) las pruebas si PostgreSQL no responde. Así corre el CI. |
| `HABICAPITAL_API_ORIGIN` | No | Frontend: a dónde reenvía el proxy `/api` (por defecto `http://127.0.0.1:8000`). |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Solo con Docker | Contenedor de PostgreSQL de `docker-compose.yml`. |

**Credenciales:** todas las que aparecen en el repositorio (`habicapital`/`habicapital`) son
ficticias, para desarrollo local y CI. La app no tiene una URL de BD por defecto.

### 3. Backend

```bash
uv run uvicorn habicapital.main:app --reload    # API → http://localhost:8000/docs
```

### 4. Frontend

```bash
cd frontend
npm ci              # dependencias exactas de package-lock.json
npm run dev         # http://127.0.0.1:5173 (desarrollo, recarga en caliente)
npm run build       # o bien: build de producción...
npm run preview     # ...servido en http://127.0.0.1:4173 con la CSP y las cabeceras de seguridad
```

Con el backend en marcha, se abre la URL, se crea una cuenta y se **guarda el token**: es la
única credencial y no se puede recuperar.

## Pruebas

| Qué | Comando | Base de datos |
|---|---|---|
| Backend (330) | `uv run pytest` | `habicapital_test` |
| Calidad del backend | `uv run ruff format --check .` · `uv run ruff check .` · `uv run mypy src tests migrations` | — |
| Frontend (403) | `cd frontend` · `npm test` | Ninguna (backend simulado solo para pruebas) |
| Calidad del frontend | `npm run lint` · `npm run typecheck` · `npm run build` | — |
| E2E (Playwright) | `cd frontend` · `npx playwright install chromium` (una vez) · `npm run test:e2e` | `habicapital_test` |

**Dos bases, nunca mezcladas.** pytest siempre usa `HABICAPITAL_TEST_DATABASE_URL` e ignora la URL
de desarrollo, aunque esté definida. Se niega a ejecutarse si el nombre de la base no termina en
`_test`, porque vacía las tablas entre pruebas. Las pruebas con BD se saltan si PostgreSQL no
responde; con `HABICAPITAL_REQUIRE_DB=1` fallan en lugar de saltarse.

**E2E aisladas.** `npm run test:e2e` levanta su propio backend en el puerto 8001 con
`frontend/e2e/backend.py`, que antes de migrar o arrancar comprueba que la base es exactamente la
local `habicapital_test`, distinta de la de desarrollo, y que PostgreSQL lo confirma
(`current_database()`). Si no, se niega a arrancar. El frontend se sirve aparte en el puerto 4174
y nunca se reutilizan servidores abiertos. Al terminar se verifican en la base las invariantes del
ledger. Cubren los flujos de dinero completos, el reintento tras un corte de red con la misma
`Idempotency-Key`, accesibilidad (axe, WCAG 2.2 AA), responsive de 320 a 1440 px y seguridad en el
navegador. El Centro de ayuda tiene sus propias pruebas de Vitest (acceso público, entrada desde la
pantalla de acceso, el menú lateral y el menú móvil, sesión conservada, rutas privadas protegidas y
acordeones con ratón y teclado) y está incluido en las pruebas E2E de accesibilidad y responsive.
Detalle en [`frontend/README.md`](frontend/README.md#pruebas-de-extremo-a-extremo-e2e).

## Cómo no se pierde un peso

- **Dinero como entero:** pesos COP en `BIGINT`/`int`. La API rechaza `100.5`, `100.0`, `"100"` y
  `true` (validación estricta), montos ≤ 0 y depósitos mayores a 10.000.000.
- **Doble partida:** cada movimiento es una transacción con asientos que suman 0. Un depósito
  debita la cuenta de sistema FUNDING (que queda en negativo) y acredita al usuario, así que la
  suma de todos los saldos es siempre 0. Las pruebas verifican tras cada escenario que: la suma
  global es 0, cada transacción cuadra, cada saldo es la suma de sus asientos y el último
  `balance_after` coincide con el saldo.
- **Atomicidad:** asientos, saldos y registro de idempotencia se confirman en un solo `COMMIT`.
  Una prueba hace fallar la operación después de escribir los asientos y comprueba que no queda
  nada.
- **Concurrencia:** las cuentas se bloquean con `SELECT ... FOR UPDATE` en orden de id. La cuenta
  autenticada se recarga al bloquearla (`populate_existing`); comprobé que sin esto la prueba de
  30 depósitos concurrentes pierde depósitos.
- **Idempotencia:** `Idempotency-Key` obligatoria. Reintentar con la misma clave devuelve la
  respuesta original (`Idempotent-Replayed: true`) sin mover plata, también con 10 peticiones
  simultáneas; reutilizarla con otro cuerpo da `422`. La clave es única por cuenta.
- **Defensas en la BD:** `CHECK` impide saldos negativos de usuario, asientos en 0 y cuentas de
  sistema con token (FUNDING no puede autenticarse). En las solicitudes de dinero, además, un
  trigger hace inmutables los estados finales (ver más abajo).

### Transferencias (`POST /accounts/me/transfers`)

- **Origen = cuenta autenticada.** El cuerpo solo trae `to_account_id`, `amount` (entero de
  1 a 10.000.000 COP) y `description`; un campo `from_account_id` se rechaza con `422`.
- **Destino:** transferirse a sí mismo da `422`; un destino inexistente o una cuenta de sistema
  (FUNDING) da `404`. Como los ids son UUID aleatorios, el `404` revela si un id existe solo a
  quien ya lo conoce.
- **Saldo:** se comprueba con las dos filas ya bloqueadas; si no alcanza, `409` y no se escribe
  nada. El `CHECK` de la BD es la última defensa.
- **Atomicidad y doble partida:** débito, crédito, ambos saldos y el registro de idempotencia van
  en un solo `COMMIT`. Una prueba hace fallar la operación tras escribir los asientos y
  comprueba que ningún saldo cambió.
- **Idempotencia:** la misma que en depósitos. Una clave usada en un depósito no sirve para una
  transferencia (`422`). 10 peticiones simultáneas con la misma clave producen una sola
  transferencia.
- **Concurrencia, probada:**
  - con 5.000 de saldo, 10 transferencias simultáneas de 1.000 dan exactamente 5 aprobadas y
    5 rechazadas (`409`), y el saldo final es 0;
  - 30 transferencias cruzadas A↔B en paralelo terminan sin errores ni deadlocks;
  - 20 transferencias de 5 emisores a un mismo receptor no pierden ningún crédito.
- **Pruebas de mutación** (introduje cada error a propósito, comprobé que las pruebas fallan y
  restauré el código):
  - sin `FOR UPDATE`: fallan las 3 pruebas de concurrencia;
  - bloqueando en el orden de los asientos en lugar de por id: falla la de transferencias
    cruzadas, y PostgreSQL registró 16 deadlocks (0 con el código correcto);
  - sin `populate_existing`: fallan las 3 pruebas de concurrencia.

### Historial (`GET /accounts/me/movements?limit=20&offset=0&order=desc`)

- **Solo lectura y solo la cuenta propia:** la cuenta sale del token y el filtro se aplica en
  la consulta; no hay ningún parámetro con un id de cuenta. No escribe ni bloquea filas.
- **Sin tablas nuevas:** cada movimiento es un asiento del ledger. El tipo sale de la
  transacción y del signo del asiento: `DEPOSIT` (`IN`), `TRANSFER_SENT` (`OUT`) y
  `TRANSFER_RECEIVED` (`IN`). `amount` es siempre positivo; el sentido lo da `direction`.
- **Contraparte:** en una transferencia, solo `account_id` y `owner_name` de la otra cuenta. En
  un depósito es `null`: FUNDING nunca se muestra.
- **Orden estable:** por el id del asiento (único y creciente), `desc` por defecto o `asc`, con
  el índice existente `(account_id, id)`.
- **Página y total coherentes:** salen de una sola sentencia SQL, que en PostgreSQL ve una única
  instantánea. Una prueba lee el historial mientras corren 30 transferencias cruzadas y
  comprueba que cada página trae exactamente `total` elementos y concilia con `balance_after`.
- **Conciliación probada:** la suma de los movimientos (+ entradas, − salidas) es igual al
  saldo, y en orden `asc` cada `balance_after` es el anterior más o menos el monto. Las
  operaciones rechazadas y los reintentos idempotentes no aparecen ni se duplican.
- **Validación:** `limit` de 1 a 100, `offset` de 0 a 1.000.000 y `order` `desc` o `asc`; fuera
  de rango, `422`. Un `offset` más allá del final devuelve `items: []` con el `total` real.

**Limitación de `limit` y `offset`:** la paginación cuenta posiciones, no movimientos. Si llegan
movimientos nuevos mientras alguien recorre las páginas en orden `desc`, todo se desplaza hacia
atrás y un movimiento ya visto puede aparecer de nuevo en la página siguiente (en `asc`, los
nuevos aparecen al final). Ningún movimiento se pierde del ledger; solo cambia la vista. Una
paginación por cursor ("los anteriores al movimiento X") lo evitaría.

### Solicitudes de dinero (`/money-requests`)

Un usuario le pide una cantidad a otro; el otro la paga o la rechaza. **Crear una solicitud no
mueve dinero**: solo aceptarla lo hace, y lo hace con la misma transferencia del ledger que
`POST /accounts/me/transfers` (no hay una segunda lógica de dinero).

| Endpoint | Quién | `Idempotency-Key` | Respuesta |
|---|---|---|---|
| `POST /money-requests` con `{payer_account_id, amount, description?}` | Cualquier usuario (el solicitante sale del token) | Obligatoria | `201`, estado `PENDING` |
| `GET /money-requests?role=sent\|received&status=&limit=&offset=&order=` | Solo tus solicitudes | — | `200`, paginado |
| `GET /money-requests/{id}` | Solicitante o pagador | — | `200` |
| `POST /money-requests/{id}/accept` | Solo el pagador | Obligatoria | `200`, con tu saldo después de pagar |
| `POST /money-requests/{id}/reject` | Solo el pagador | — | `200` |
| `POST /money-requests/{id}/cancel` | Solo el solicitante | — | `200` |

**Estados.** `PENDING` pasa a `ACCEPTED` (se ejecuta la transferencia), `REJECTED` o
`CANCELLED`, y esos tres estados finales no cambian nunca. Aceptar sin saldo suficiente
responde `409` y la solicitud sigue `PENDING`. Cualquier acción sobre una solicitud ya resuelta
responde `409` (`"La solicitud ya no está pendiente"`). No implementé vencimiento (`EXPIRED`).

**Validación al crear.** Monto entero de 1 a 10.000.000 COP (el mismo tope que una
transferencia, para no crear solicitudes imposibles de aceptar); pedirte a ti mismo da `422`;
un pagador inexistente o FUNDING da `404`. No se comprueba el saldo del pagador: hacerlo le
revelaría su saldo al solicitante.

**Permisos y privacidad.**
- Las rutas van en `/money-requests` y no en `/accounts`: el id de la URL identifica una
  solicitud, nunca una cuenta. Pruebas estructurales verifican que ninguna ruta de `/accounts`
  reciba un id en la URL y que en `/money-requests` el único parámetro de ruta sea `request_id`.
- Cada consulta filtra por la cuenta del token. Una solicitud ajena, o una acción que no te
  corresponde (p. ej. que el solicitante intente aceptar su propia solicitud), responde el mismo
  `404` que una solicitud inexistente.
- De cada parte solo se muestran `account_id` y `owner_name`. Las respuestas nunca incluyen el
  saldo de otra cuenta; aceptar devuelve solo el saldo del propio pagador.

**Atomicidad al aceptar.** Todo va en una sola transacción de PostgreSQL: se bloquea la
solicitud; `transfer()` bloquea las dos cuentas y escribe los asientos (no confirma por su
cuenta); la solicitud pasa a `ACCEPTED` con su `transaction_id` y `resolved_at`; y se guarda el
registro de idempotencia. Hay un único `COMMIT`. Las pruebas hacen fallar la operación justo
después de la transferencia, al guardar el estado (violando un `CHECK`) y al guardar el registro
de idempotencia: en los tres casos la solicitud queda `PENDING` y ningún saldo cambia.

**Idempotencia.** Crear y aceptar usan el mismo mecanismo que depósitos y transferencias. Si la
respuesta de una aceptación se pierde, repetirla con la misma clave devuelve la respuesta
original (`Idempotent-Replayed: true`) aunque la solicitud ya esté `ACCEPTED`, sin una segunda
transferencia. La misma clave con otra solicitud u otra operación da `422`. Un `409` por saldo
insuficiente no consume la clave.

**Concurrencia.** Hay un único orden de bloqueo en todo el sistema: primero la solicitud
(`SELECT ... FOR UPDATE`) y después las cuentas, en orden ascendente de id dentro de
`transfer()`. El estado se comprueba con la fila ya bloqueada. Al aceptar, la solicitud se
bloquea **antes** de consultar la clave de idempotencia: así, de dos aceptaciones simultáneas
con la misma clave, la segunda espera y repite la respuesta de la primera en lugar de recibir
`409`. Probado:
- 10 aceptaciones simultáneas con claves distintas: una `200`, nueve `409`, un solo débito;
- 10 con la misma clave: diez `200` con el mismo cuerpo, nueve marcadas como repetidas;
- la misma clave en dos solicitudes a la vez: una paga y la otra recibe `422`;
- aceptar, rechazar y cancelar compitiendo en 12 solicitudes: exactamente un ganador por
  solicitud, y la plata se movió si y solo si ganó aceptar;
- con 5.000 de saldo, 10 solicitudes de 1.000 aceptadas a la vez: 5 pagadas y 5 `PENDING`;
- 20 aceptaciones cruzadas entre dos cuentas mezcladas con 10 transferencias: sin deadlocks.

**Defensas en la BD.** Los `CHECK` exigen monto positivo, solicitante distinto del pagador,
estado válido, `transaction_id` presente si y solo si está `ACCEPTED` y `resolved_at` si y solo
si ya no está `PENDING`; además, `transaction_id` es único (una transferencia no salda dos
solicitudes). Un trigger (`money_requests_guard_final_states`) rechaza cualquier `UPDATE` o
`DELETE` de una solicitud resuelta: no vuelve a `PENDING`, no pasa de un estado final a otro y
una aceptada no pierde ni cambia su transferencia. Mientras está `PENDING`, sus partes, su monto
y su descripción tampoco cambian. Comprobé que, si el servicio dejara de verificar el estado,
una segunda aceptación ya no pagaría dos veces: la BD la rechaza y la transferencia se deshace.

**Pruebas de mutación** (introduje cada error a propósito y restauré el código):
- bloquear la solicitud después de consultar la clave: falla la prueba de la misma clave en
  paralelo;
- no verificar `PENDING` al aceptar: fallan 5 pruebas;
- sin `FOR UPDATE` en la solicitud: fallan las de concurrencia de aceptar, rechazar y cancelar;
- un `COMMIT` justo después de `transfer()`: fallan 6 pruebas de atomicidad y concurrencia.

**Limitaciones de las solicitudes:**
- No hay vencimiento (`EXPIRED`): una solicitud puede quedar `PENDING` indefinidamente.
- Quien conoce tu id puede enviarte solicitudes sin límite (no hay límite de peticiones).
- Crear una solicitud revela con `404` si un id de cuenta existe, igual que transferir; los ids
  son UUID aleatorios.
- Si la respuesta de una aceptación se pierde y el cliente reintenta con **otra** clave, recibe
  `409`: no hay forma de saber que es la misma intención, así que debe reutilizar la clave.
- Una respuesta repetida muestra el saldo del momento de la aceptación original, no el actual.
- El listado usa `limit`/`offset`, con la misma limitación que el historial.
- Revertir la migración de solicitudes elimina la tabla: no cambia saldos ni asientos, pero se
  pierde el vínculo entre cada solicitud aceptada y su transferencia (que sigue en el ledger).

**Limitaciones:** todos los depósitos bloquean la fila de FUNDING, así que se serializan entre sí
(suficiente para este alcance, un cuello de botella a escala). Solo se guardan respuestas
exitosas para idempotencia: un rechazo (p. ej. saldo insuficiente) no consume la clave y un
reintento se vuelve a evaluar. Los registros de idempotencia no expiran. Revertir la migración
de transferencias se niega a continuar si ya hay transferencias registradas, porque borrarlas
descuadraría los saldos.

### Idempotencia y operaciones simuladas en la interfaz

El backend garantiza que una misma `Idempotency-Key` nunca mueve plata dos veces. La interfaz se
encarga de **usar bien esa garantía** cuando no sabe si una operación se hizo:

- **Una clave por intención.** Cada recarga, transferencia, creación de solicitud y pago de
  solicitud genera una `Idempotency-Key` aleatoria (`crypto.randomUUID`) al confirmar, y la guarda
  en `sessionStorage` junto con los datos exactos de la operación.
- **Resultado incierto = pendiente, no error.** Si la red falla, se agota el tiempo, el servidor
  responde 5xx o la respuesta no es válida, la pantalla dice «No sabemos si … se realizó», no
  muestra éxito ni fracaso y conserva la operación con su clave, también si se recarga la
  página.
- **Reintento manual con la misma clave.** «Reintentar con la misma clave» reenvía exactamente el
  mismo cuerpo. Si la primera sí llegó, el servidor responde `Idempotent-Replayed: true` y la
  pantalla dice «ya se había aplicado» o «ya había sido pagada» sin cobrar de nuevo. Nunca se
  reintenta solo y nunca se genera una clave nueva para una operación incierta.
- **Mientras una recarga, transferencia o solicitud nueva esté pendiente, no se puede iniciar otra
  distinta del mismo tipo**, para que nadie envíe dos veces el mismo dinero creyendo que la primera
  falló. Un pago pendiente bloquea solo esa solicitud.
- **«Dejar de intentar recuperar»** pide confirmación y explica que solo borra la información del
  navegador: no cancela ni revierte nada en el servidor.
- **Rechazar y cancelar** una solicitud no son idempotentes en la API. Ante un error de red la
  interfaz no reintenta: consulta el estado real (`GET /money-requests/{id}`) y lo muestra.
- **Doble clic:** cada operación bloquea su botón mientras está en curso; un doble clic envía una
  sola petición.
- **El saldo siempre viene del servidor** (`balance` de la respuesta o `GET /accounts/me`); la
  interfaz solo muestra estimaciones marcadas como tales en las confirmaciones.

**Evidencia:** pruebas de Vitest para cada operación (error de red, 5xx, respuesta ilegible,
timeout, recarga de la página, doble clic) y pruebas E2E con un corte de red real: la petición
llega a FastAPI y se procesa, pero la respuesta no llega al navegador. El reintento usa la misma
clave, el saldo cambia una sola vez en PostgreSQL y al final las invariantes del ledger se
cumplen.

## Seguridad: autenticación y autorización

El reto no exige autenticación, pero sin ella cualquiera que conozca el id de una cuenta podría
mover su plata. Implemento un mecanismo mínimo que **simula la identidad**; no es un sistema de
autenticación de producción.

### Autenticación: ¿quién eres?

- Al crear una cuenta, la API genera un **token aleatorio de 256 bits** (`secrets.token_urlsafe(32)`)
  y lo devuelve **una única vez** en esa respuesta.
- En la base de datos solo se guarda el **hash SHA-256** del token. SHA-256 sin sal es suficiente
  porque el token es aleatorio y de alta entropía: no hay diccionario que atacar, a diferencia de
  una contraseña humana (que sí necesitaría bcrypt o argon2).
- Cada petición envía `Authorization: Bearer <token>`. Una dependencia de FastAPI calcula el hash,
  busca la cuenta y la inyecta como cuenta actual. Sin token o con un token inválido: `401`.

### Autorización: ¿puedes hacer esto?

- Las operaciones sobre la propia cuenta usan rutas `/accounts/me/...`: el id de la cuenta no
  viene en la petición, se deduce del token. Así no hay un id ajeno que manipular.
- El origen de una transferencia es siempre la cuenta autenticada; el cuerpo solo trae el destino.
- Cada caso de uso vuelve a comprobar el permiso en el servicio (no solo en el router):
  - solo el pagador de una solicitud de dinero puede aceptarla o rechazarla;
  - solo quien la creó puede cancelarla.
- Un recurso ajeno responde `404`, no `403`, para no confirmar que existe.

### El token nunca se persiste en claro

- **Base de datos:** solo el hash. Un `CHECK` exige 64 caracteres, así que la propia BD rechaza
  guardar algo que no sea un hash SHA-256.
- **Idempotencia:** crear cuenta y regenerar token no pasan por los registros de idempotencia
  (solo los usan depósitos, transferencias y solicitudes de dinero). Las respuestas con token
  nunca se guardan para repetirlas.
- **Logs:** no se registran cabeceras ni cuerpos de las peticiones; el token nunca se acepta en
  la URL. El motor de BD usa `hide_parameters=True`, así que los valores de las sentencias no
  aparecen en logs ni en mensajes de error.
- **Cachés:** las respuestas con token llevan `Cache-Control: no-store`.
- **Pruebas** (todas pasan, también en el CI):
  - Un fallo después de generar el token no lo expone en la respuesta 500 ni en la traza.
  - Volcado de todas las filas de todas las tablas tras crear y regenerar: el token no aparece.
  - Con todo el logging en DEBUG, incluido el SQL, el token no aparece.
  - Con el log de SQL en INFO, tampoco aparece el hash.

  En DEBUG SQLAlchemy registra también las filas devueltas, que incluyen el hash. Es aceptable
  solo en depuración local: el hash no permite autenticarse.

### Regenerar el token

`POST /accounts/me/token` (autenticado con el token actual) genera un token nuevo, reemplaza el
hash en una sola sentencia y devuelve el token nuevo una única vez. El anterior queda inválido de
inmediato. Sirve tanto para rotarlo como para revocar uno filtrado.

El `UPDATE` solo se aplica si el hash guardado sigue siendo el del token con el que se autenticó
la petición. Si llegan dos regeneraciones simultáneas con el mismo token, solo una emite token
nuevo; la otra recibe `401`.

No ofrezco "revocar sin reemplazo": como no hay forma de recuperar el acceso, dejaría la cuenta,
y su saldo, inaccesible para siempre.

### El token en el navegador

- **Dónde vive:** en memoria y en `sessionStorage` de la pestaña, que se borra al cerrarla. Nunca
  en `localStorage`, cookies, URLs, `history.state`, logs ni mensajes de error. Solo viaja en la
  cabecera `Authorization`.
- **Entrar:** el token se valida con `GET /accounts/me` antes de guardarlo; si el servidor no lo
  acepta, no queda guardado en ningún sitio.
- **Crear cuenta:** el token se muestra una sola vez, con botón de copiar y la obligación de
  confirmar «Ya guardé mi token» antes de continuar. Si la pestaña se recarga antes de confirmar,
  la sesión sigue y se avisa que conviene regenerarlo.
- **Sesión:** un `401` en cualquier llamada cierra la sesión. Cerrar sesión borra el token y las
  operaciones pendientes de esa cuenta, y las pantallas se vuelven a montar por cuenta, así que no
  quedan datos de la sesión anterior.
- **Cabeceras (`vite preview`):** CSP estricta (todo `'self'`, sin scripts ni estilos en línea,
  `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy` y `Cross-Origin-Opener-Policy`. Sin analítica ni
  scripts externos: hasta la tipografía está autoalojada.
- **Evidencia:** pruebas de Vitest que buscan el token en URLs, cuerpos, claves, almacenamiento,
  DOM y consola, y una prueba E2E que recorre la pantalla de acceso y las seis privadas comprobando que todo se carga del
  mismo origen, que no hay errores de CSP y que el token no aparece fuera de `Authorization`.

## Limitaciones conocidas

**Del backend:**

- No hay contraseñas, login ni recuperación de acceso: **quien pierde el token pierde la cuenta.**
- **Crear cuenta no es idempotente.** Si la respuesta de `POST /accounts` se pierde y el cliente
  reintenta, se crean dos cuentas, y la primera queda sin token conocido. Lo acepto porque una
  cuenta nueva tiene saldo 0 y nadie conoce su id (venía en la respuesta perdida), así que nadie
  puede enviarle plata. Hacerla idempotente exigiría guardar el token para repetir la respuesta,
  que es justo lo que no quiero hacer.
- **Regeneración con resultado incierto.** Si la conexión se corta después de que la BD confirma
  el cambio pero antes de que llegue la respuesta, el token anterior ya no sirve y el nuevo nunca
  llegó: el usuario pierde el acceso. Es poco probable y no tiene solución sin guardar el token.
- Si alguien regenera el token antes que el dueño legítimo (porque lo robó), el dueño queda fuera.
- Los tokens no expiran; solo se invalidan al regenerarlos.
- Hay un solo token por cuenta, sin permisos más finos ni sesiones por dispositivo.
- Quien obtiene el token tiene acceso total a esa cuenta.
- No hay HTTPS en el entorno local; en producción sería obligatorio.
- No hay límite de peticiones ni bloqueo por intentos fallidos. Con 256 bits no es práctico
  adivinar un token, pero no hay protección contra abuso o denegación de servicio.
- La cuenta no está ligada a una identidad verificada (no hay KYC): el nombre lo declara el usuario.

**Del frontend:**

- La demo se sirve con `vite preview`, que no es un servidor de producción. Un despliegue real
  necesita un servidor estático con las mismas cabeceras de seguridad, HTTPS y HSTS.
- El token vive en `sessionStorage`: un script malicioso en la misma página podría leerlo. La CSP
  estricta y la ausencia de scripts de terceros reducen ese riesgo, pero no lo eliminan; una
  cookie `HttpOnly` exigiría cambiar el esquema de autenticación del backend.
- Si se pierde la respuesta al crear una cuenta, la interfaz no puede saber si se creó (crear
  cuenta no es idempotente en la API) y lo dice sin reintentar.
- `npm audit` informa avisos moderados solo en herramientas de desarrollo (`minimatch` a través de
  ESLint y typescript-eslint). `npm audit --omit=dev` da 0 vulnerabilidades.
- Las pruebas E2E y la accesibilidad automatizada se ejecutan en Chromium; Firefox y Safari no
  están probados.

## Respuestas del reto

### 1. Las decisiones clave y por qué las tomé

Una de las primeras decisiones que tomé fue utilizar **Python con FastAPI** para desarrollar el backend. Elegí esta tecnología por recomendación de un amigo, ya que anteriormente no había trabajado con ella. Aunque al principio representó un reto, lo vi como una oportunidad para aprender algo nuevo y familiarizarme con el desarrollo de APIs.

Otra decisión importante fue crear una **interfaz web completa**, aunque el reto no la exigía explícitamente. Quería que HabiCapital fuera fácil de utilizar y que las personas pudieran realizar operaciones sin necesidad de interactuar directamente con los endpoints. Además, aproveché esta oportunidad para retomar y reforzar mis conocimientos de desarrollo web, especialmente CSS.

Como funcionalidad adicional decidí implementar **solicitudes de dinero entre usuarios**. Quería ofrecer algo diferente a las operaciones básicas de una billetera digital. Me pareció interesante porque no es una función que haya visto frecuentemente en las aplicaciones bancarias que conozco. Además, puede resultar útil en situaciones cotidianas, como dividir gastos entre amigos o solicitar pagos pendientes.

En cuanto a la seguridad y el manejo del dinero, me apoyé en Claude Code. La IA me propuso utilizar PostgreSQL, contabilidad de doble partida e idempotencia para proteger las operaciones. Como varios de estos conceptos eran nuevos para mí, le pedía explicaciones antes de aprobar su implementación, buscando comprender qué problema resolvía cada mecanismo.

En general, busqué que el proyecto no solo cumpliera los requisitos del reto, sino que también fuera una aplicación fácil de usar y que me permitiera aprender nuevas tecnologías.

### 2. Cómo sé que mi sistema no pierde un peso

Para comprobar que HabiCapital no pierde dinero, me apoyé en diferentes pruebas automatizadas que verifican cuatro mecanismos principales: la idempotencia, la contabilidad de doble partida, la atomicidad y el control de concurrencia.

La **idempotencia** evita que una misma operación se ejecute dos veces cuando ocurre un problema de conexión y el usuario vuelve a intentarla. La **contabilidad de doble partida** permite comprobar que cada peso que sale de una cuenta llega a otra y que los registros contables permanecen equilibrados.

Por otra parte, la **atomicidad** garantiza que una operación se complete totalmente o que sus cambios se deshagan si ocurre un error. Finalmente, el **control de concurrencia** evita que varias transferencias simultáneas utilicen incorrectamente el mismo saldo.

Para verificar estas protecciones, se realizaron pruebas que simulan errores de conexión, operaciones simultáneas y fallos durante las transferencias. Por ejemplo, una prueba ejecuta diez transferencias de $1.000 desde una cuenta con $5.000: cinco se completan y cinco se rechazan por saldo insuficiente, sin que el dinero se pierda ni el saldo quede negativo.

También se implementaron pruebas de extremo a extremo con Playwright, FastAPI y PostgreSQL para comprobar el comportamiento del sistema completo, incluyendo escenarios en los que una operación se procesa, pero la respuesta no llega al navegador.

Por eso considero que tengo evidencia sólida de que HabiCapital mantiene la consistencia del dinero en los escenarios evaluados, aunque reconozco que las pruebas no garantizan la ausencia absoluta de errores.

### 3. Qué dejé fuera y por qué

Durante el desarrollo de HabiCapital decidí concentrarme principalmente en cumplir los requisitos del reto y asegurarme de que cada funcionalidad estuviera implementada correctamente.

Aunque existían varias posibilidades para ampliar el proyecto, preferí enfocarme en las operaciones principales, como crear cuentas, recargar saldo, realizar transferencias y consultar movimientos, además de implementar las solicitudes de dinero como funcionalidad adicional.

Por cuestiones de tiempo, dejé fuera algunas características que podrían mejorar la aplicación, como las notificaciones, la recuperación de cuentas cuando se pierde el token de acceso y otras funciones más avanzadas.

Consideré que era más importante entregar un sistema funcional, con una interfaz fácil de utilizar y pruebas que respaldaran la seguridad de sus operaciones, en lugar de agregar más características sin poder comprobar adecuadamente su funcionamiento.

Mi prioridad fue desarrollar de la mejor manera posible lo que pedía el reto, manteniendo un alcance que pudiera manejar durante el tiempo disponible.

### 4. Qué haría distinto con más tiempo

Si hubiera tenido más tiempo, me habría gustado explorar la posibilidad de integrar operaciones con dinero real, empezando por estudiar una implementación sencilla y controlada. Aunque HabiCapital funciona actualmente con dinero simulado, considero interesante investigar cómo podría evolucionar hacia una aplicación financiera real, teniendo en cuenta los requisitos adicionales de seguridad, regulación e integración con servicios de pago.

También me habría gustado implementar una funcionalidad para **dividir cuentas entre varias personas**, algo que considero especialmente útil cuando un grupo de amigos comparte gastos, como una cena o un viaje. Esta función complementaría las solicitudes de dinero que ya desarrollé.

Otra mejora que habría explorado es un **resumen de movimientos**, en el que cada usuario pudiera consultar cuánto dinero ha enviado y recibido durante un período, identificar sus transferencias más frecuentes y visualizar esa información mediante gráficos sencillos.

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

Este proyecto me enseñó que incluso una aplicación que parece sencilla puede tener una complejidad considerable cuando se busca que funcione correctamente. También comprendí que es importante identificar los supuestos desde el principio, porque estos influyen directamente en las decisiones que se toman durante el desarrollo.

### 7. Cómo utilicé la inteligencia artificial

La inteligencia artificial tuvo un papel muy importante durante el desarrollo de HabiCapital. Utilicé principalmente Claude Code y ChatGPT, además de Google Stitch y Figma para trabajar en el diseño de la interfaz.

Mi dinámica consistía en utilizar ChatGPT para analizar ideas, organizar las etapas del proyecto y comprender las propuestas técnicas. Después utilizaba Claude Code para implementar las funcionalidades, configurar las herramientas, escribir pruebas y corregir errores.

Como varias tecnologías eran nuevas para mí, procuraba pedir explicaciones antes de aprobar las propuestas. Por ejemplo, Claude me recomendó utilizar contabilidad de doble partida, idempotencia y mecanismos de concurrencia para proteger las operaciones. Aunque inicialmente no conocía estos conceptos, fui comprendiendo su propósito durante el desarrollo.

Para la interfaz utilicé **Google Stitch**, que me permitió generar los diseños iniciales de las pantallas. Posteriormente trabajé con **Figma** para organizarlos y utilizarlos como referencia, mientras Claude Code se encargaba de implementarlos en React, TypeScript y CSS.

Aunque la IA propuso e implementó gran parte de las soluciones técnicas, yo participé definiendo el alcance, seleccionando la funcionalidad adicional, tomando decisiones sobre la experiencia de usuario y aprobando las diferentes etapas.

También comprobé que la IA puede cometer errores. Durante una auditoría se descubrió que una respuesta tardía del servidor podía actualizar el saldo de una cuenta después de cambiar de sesión, mostrando información incorrecta. Claude tuvo que corregir ese comportamiento y añadir verificaciones para evitar que volviera a ocurrir.

Esta experiencia me enseñó que la IA es una herramienta muy útil para desarrollar proyectos complejos, especialmente cuando todavía estoy aprendiendo, pero que sus resultados deben revisarse y comprobarse mediante pruebas. También entendí la importancia de hacer preguntas y no aceptar automáticamente todas sus recomendaciones.

### 8. Qué aprendí

Durante el desarrollo de HabiCapital aprendí muchas cosas que no conocía y reforcé algunos conocimientos que ya tenía.

Uno de los descubrimientos que más me llamó la atención fue el uso de las conexiones **MCP (Model Context Protocol)**. Antes de comenzar el proyecto no conocía estas herramientas y me sorprendió cómo permiten conectar la inteligencia artificial con otros servicios y facilitar diferentes tareas del desarrollo. Herramientas como Serena, Context7 y la integración con Figma fueron de gran ayuda durante el proceso.

También aprendí sobre el funcionamiento de las **API**, especialmente utilizando FastAPI. Aunque todavía me falta bastante por aprender, ahora comprendo mejor cómo se comunica una interfaz con un servidor, cómo se organizan los endpoints y cómo se conecta una aplicación con una base de datos.

Otro aprendizaje importante fue conocer mejor **GitHub y GitHub Actions**. Antes no estaba familiarizado con muchas de estas herramientas y me pareció interesante descubrir cómo se pueden automatizar las pruebas para comprobar que los cambios del proyecto funcionan correctamente.

Sin embargo, lo que más me sorprendió fue descubrir **lo complejo que puede llegar a ser un sistema financiero**, incluso cuando utiliza dinero simulado. Al principio imaginaba que el reto sería mucho más sencillo, pero durante el desarrollo comprendí que hay muchos aspectos que deben considerarse para evitar errores, como las operaciones duplicadas, los problemas de conexión y las transferencias simultáneas. Esto me hizo pensar en la enorme complejidad que debe tener construir un sistema financiero real desde cero y a gran escala.

Me llevo de esta experiencia nuevos conocimientos técnicos, una mejor comprensión de cómo se desarrolla una aplicación completa y, sobre todo, la importancia de seguir aprendiendo, hacer preguntas y comprobar que las soluciones realmente funcionan. También descubrí lo útil que puede ser la inteligencia artificial cuando se utiliza como una herramienta de apoyo para aprender y desarrollar proyectos.
