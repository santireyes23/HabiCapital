# HabiCapital: billetera P2P

API para que un grupo de personas se mueva plata entre sí sin pasar por el banco, guardando el
contexto de cada movimiento (el cumpleaños, el arriendo, la parte de la cena que alguien te pide).

**Funcionalidades:** crear cuenta (con token Bearer), depósito simulado, transferencia, saldo,
historial de movimientos y, como funcionalidad adicional, **solicitudes de dinero entre usuarios**.

**Stack:** Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 18 · pytest · httpx ·
uv · Ruff · mypy · Docker Compose · GitHub Actions.

> **Estado: borrador en construcción.** Este README irá creciendo por etapas. La versión final
> responderá en primera persona los ocho puntos que pide el reto.

## Estado de verificación

| Etapa | Implementado | Verificado |
|---|---|---|
| 0. Estructura, tooling, CI | Sí | Sí: local y en GitHub Actions. |
| 1. Identidad (cuentas y tokens) | Sí | Sí: PostgreSQL 18 local y en CI. |
| 2. Saldo, ledger de doble partida, cuenta FUNDING, depósitos idempotentes | Sí | Sí: PostgreSQL 18 local y en CI (incluye concurrencia y fallo a mitad de operación). |
| 3. Transferencias entre usuarios | Sí | Sí: PostgreSQL 18 local y en CI (incluye concurrencia, idempotencia y fallo a mitad de operación). |
| 4. Historial de movimientos | Sí | Sí: PostgreSQL 18 local y en CI (incluye aislamiento entre cuentas, paginación y lecturas concurrentes). |
| 5. Solicitudes de dinero entre usuarios | Sí | **Solo local** (PostgreSQL 18): aún no se ha subido ni ejecutado en CI. Incluye permisos, idempotencia, atomicidad, concurrencia y protección de estados finales en la BD. |

**Integración continua:** todas las ejecuciones de GitHub Actions terminaron correctamente, con
PostgreSQL 18 como servicio:

| Ejecución | Commit | Cubre | pytest |
|---|---|---|---|
| CI #1 | `45adf5c` | Etapas 0–2 | 77 de 77 aprobadas |
| CI #2 | `5e27c55` | Etapas 0–2 | 77 de 77 aprobadas |
| CI #3 | `406a471` | Etapas 0–3 | **117 de 117 aprobadas** |
| CI #4 | `9869515` | Etapas 0–3 | 117 de 117 aprobadas |
| CI #5 | `8104660` | Etapas 0–4 | **144 de 144 aprobadas, 0 omitidas** |
| CI #6 | `0c2d16b` | Etapas 0–4 (solo cambió el README) | 144 de 144 aprobadas, 0 omitidas |

**Etapa 5, verificación local:** 330 de 330 pruebas aprobadas, 0 omitidas, con
`HABICAPITAL_REQUIRE_DB=1`, además de Ruff, mypy y las migraciones desde cero y con downgrade.
Esta tabla se actualizará con la ejecución del CI cuando se suban los cambios.

En cada ejecución, Ruff (formato y lint) y mypy estricto (`src`, `tests`, `migrations`) pasaron
sin errores, y las migraciones Alembic (`upgrade head`) se aplicaron. Ninguna prueba se saltó:
el CI usa `HABICAPITAL_REQUIRE_DB=1`, que hace fallar en lugar de saltar las que necesitan BD.

"Verificado" significa que la suite pasa en mi máquina y en el CI (salvo donde dice "solo
local").

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

## Cómo ejecutarlo (Windows / PowerShell)

Requisitos: [uv](https://docs.astral.sh/uv/) y Docker Desktop.

```bash
copy .env.example .env                          # configuración local (obligatoria; edítala)
uv sync                                         # dependencias (instala Python 3.12 si falta)
docker compose up -d db                         # PostgreSQL 18
uv run alembic upgrade head                     # migraciones
uv run uvicorn habicapital.main:app --reload    # API → http://localhost:8000/docs
uv run pytest                                   # pruebas
```

Calidad: `uv run ruff format .`, `uv run ruff check .`, `uv run mypy src tests migrations`.

**Sin Docker (PostgreSQL 18 instalado en Windows):** se omite `docker compose`. Hay que crear una
vez el usuario y las dos bases que Compose crearía. Con `psql -U postgres`:

```sql
CREATE ROLE habicapital LOGIN PASSWORD 'habicapital';
CREATE DATABASE habicapital OWNER habicapital;
CREATE DATABASE habicapital_test OWNER habicapital;
```

**Dos bases, dos variables** (ambas en `.env` o en el entorno):

| Variable | Base | La usa |
|---|---|---|
| `HABICAPITAL_DATABASE_URL` | `habicapital` | La API y Alembic |
| `HABICAPITAL_TEST_DATABASE_URL` | `habicapital_test` | Solo pytest |

pytest siempre usa `HABICAPITAL_TEST_DATABASE_URL` e ignora la URL de desarrollo, aunque esté
definida. Si no se define, usa las credenciales ficticias de desarrollo. La suite se niega a ejecutarse si el nombre de la base no termina en `_test`, porque vacía las
tablas entre pruebas. Las pruebas con BD se saltan si PostgreSQL no responde; con
`HABICAPITAL_REQUIRE_DB=1` (así corre el CI) fallan en lugar de saltarse.

**Credenciales:** todas las que aparecen en el repositorio (`habicapital`/`habicapital`) son
ficticias, para desarrollo local y CI. La app no tiene una URL de BD por defecto: sin
`HABICAPITAL_DATABASE_URL` no arranca.

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

### Limitaciones conocidas

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
