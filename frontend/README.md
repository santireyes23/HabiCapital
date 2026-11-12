# HabiCapital: frontend web

Interfaz web de la billetera P2P sobre la API FastAPI del repositorio. Implementa las siete
pantallas del diseño de Figma («HabiCapital - Diseño Web»): acceso, Inicio, Enviar dinero,
Recargar saldo, Solicitudes de dinero, Movimientos y Mi cuenta.

**Stack:** React 19 · TypeScript 6 (estricto) · Vite 8 · Tailwind CSS 4 · React Router 8 ·
Vitest 5 + Testing Library · Playwright + axe-core · Manrope autoalojada.

Todos los datos vienen del backend real. La aplicación no tiene datos ficticios, analítica ni
scripts de terceros.

## Requisitos

- Node.js 22.12 o superior (`engines` en `package.json`); verificado con Node 24, la versión del CI.
- El backend del repositorio funcionando (ver el README principal): `uv run uvicorn habicapital.main:app`.

## Cómo ejecutarlo

Desde `frontend/`:

```bash
npm ci                 # dependencias exactas de package-lock.json
npm run dev            # http://127.0.0.1:5173 (recarga en caliente, sin CSP)
npm run build          # comprueba tipos y genera dist/
npm run preview        # http://127.0.0.1:4173: el build con la CSP y las cabeceras de seguridad
```

El navegador llama a la API en `/api/...` y Vite la reenvía (proxy) a FastAPI quitando el
prefijo. Por defecto el destino es `http://127.0.0.1:8000`; se cambia con
`HABICAPITAL_API_ORIGIN`. Así todo sale del mismo origen: no hace falta CORS y la CSP puede ser
`connect-src 'self'`.

## Calidad y pruebas

| Comando | Qué hace |
|---|---|
| `npm run lint` | ESLint (typescript-eslint `strictTypeChecked`, reglas de hooks, `no-console`), sin advertencias permitidas |
| `npm run typecheck` | `tsc -b` de la app, la configuración y las pruebas E2E |
| `npm test` | Vitest: pruebas unitarias y de integración contra un backend simulado **solo de pruebas** (`src/test/fakeBackend.ts`) que imita códigos, formas y errores de la API real |
| `npm run test:e2e` | Playwright contra FastAPI + PostgreSQL **reales**, en un entorno aislado (abajo) |

### Pruebas de extremo a extremo (E2E)

`npm run test:e2e` levanta su propio entorno y nunca reutiliza servidores ya abiertos:

- **Backend en :8001**, con `e2e/backend.py`. Antes de arrancar comprueba que:
  - la base viene de `HABICAPITAL_TEST_DATABASE_URL`, se llama exactamente `habicapital_test`, es local y no coincide con la de desarrollo;
  - una vez conectado, PostgreSQL confirma `current_database() = 'habicapital_test'`.

  Si algo no cuadra, se niega a arrancar. Después migra esa base a `head`.
- **Frontend en :4174**, con un build aparte (`dist-e2e/`) servido por `vite preview`, con la misma CSP que la demo.
- **Al terminar**, `backend.py check` verifica en la base las invariantes del ledger:
  - los saldos suman 0;
  - cada transacción cuadra y cada saldo es igual a la suma de sus asientos;
  - ninguna cuenta queda en negativo;
  - cada solicitud aceptada tiene exactamente una transacción.

Cubren:

- **Flujos:** crear cuenta, entrar con el token, recargar, transferir entre dos cuentas, movimientos, crear, aceptar, rechazar y cancelar solicitudes, saldo insuficiente, una solicitud resuelta desde otra sesión y un token revocado.
- **Idempotencia con un corte de red real:** la petición llega al servidor pero la respuesta no llega al navegador. El reintento usa la misma `Idempotency-Key` y no duplica el dinero.
- **Accesibilidad:** axe (WCAG 2.2 AA) en las siete pantallas, confirmaciones y formularios, en escritorio y en móvil, más navegación con teclado.
- **Responsive:** sin desbordamiento horizontal a 320, 375, 768, 1024 y 1440 px.
- **Seguridad:**
  - cabeceras y CSP;
  - ningún recurso de otro origen ni errores en la consola;
  - el token solo viaja en `Authorization`;
  - nada se guarda en `localStorage` ni en cookies.

La primera vez hay que instalar el navegador: `npx playwright install chromium`.

## Integración continua

`.github/workflows/ci.yml` tiene tres jobs:

| Job | Qué hace |
|---|---|
| `checks` | Backend: Ruff, mypy, migraciones y pytest con PostgreSQL 18 |
| `frontend` | `npm ci`, ESLint, TypeScript, Vitest y build (Node 24) |
| `e2e` | Después de los dos anteriores: PostgreSQL 18 (`habicapital_test`), backend con `uv`, Chromium y `npm run test:e2e`. Solo define `HABICAPITAL_TEST_DATABASE_URL`, nunca la URL de desarrollo. Si falla, publica el informe de Playwright como artefacto durante 7 días. |

Las acciones están fijadas por SHA y el workflow solo tiene permiso de lectura.

## Estructura

```
src/
  api/         cliente HTTP (timeouts, errores tipados), endpoints e idempotencia
  session/     sesión (estados anónima / verificando / activa / sin conexión) y almacén del token
  routes/      rutas, protección de rutas privadas y carga diferida de pantallas
  layout/      barra lateral, menú móvil y contador de solicitudes pendientes
  pages/       una carpeta por pantalla (componentes + lógica pura con sus pruebas)
  components/  piezas compartidas con los estilos de Figma (botones, avisos, estados, iconos)
  lib/         dinero, fechas, almacenamiento seguro, carga de datos
  styles/      tokens de diseño de Figma (Tailwind @theme)
  test/        backend simulado y utilidades SOLO para pruebas
e2e/           pruebas Playwright y el lanzador aislado del backend
config/        proxy y cabeceras de seguridad de vite dev/preview
```

## Decisiones de seguridad

- **Token Bearer:**
  - vive en memoria y en `sessionStorage`, así que se borra al cerrar la pestaña;
  - nunca va en `localStorage`, cookies, URLs, `history.state`, logs ni mensajes de error;
  - solo viaja en la cabecera `Authorization`;
  - al entrar se valida contra `GET /accounts/me` **antes** de guardarlo.
- **Sesión:**
  - un `401` en cualquier llamada cierra la sesión;
  - al cerrar sesión se borran el token y las operaciones pendientes de esa cuenta;
  - las pantallas se montan de nuevo por cuenta, así que no quedan datos de la sesión anterior.
- **Operaciones de dinero idempotentes:**
  - cada recarga, transferencia, solicitud y pago lleva una `Idempotency-Key` aleatoria (`crypto.randomUUID`);
  - si el resultado es incierto (red, timeout, 5xx, respuesta ilegible), la operación queda pendiente en `sessionStorage` con la **misma** clave;
  - el reintento es manual, nunca automático.
  - «Dejar de intentar recuperar» pide confirmación y explica que no revierte nada en el servidor.
- **Rechazar y cancelar** no son idempotentes en la API: ante un error de red no se reintentan y se consulta el estado real.
- **`vite preview` envía:**
  - una CSP estricta: todo `'self'`, sin scripts ni estilos en línea, `frame-ancestors 'none'`;
  - `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` y `Cross-Origin-Opener-Policy`.
  - **En un despliegue real** el servidor estático debe enviar las mismas cabeceras (y HSTS sobre HTTPS).
- **Build:** sin source maps, y las fuentes nunca se incrustan como `data:`, porque la CSP las bloquearía.

## Rendimiento

Cada pantalla es un archivo JS aparte (`React.lazy`). Con la sesión abierta, las demás se
precargan en segundo plano, así que navegar no espera a la red.

| | Antes | Después |
|---|---|---|
| JS inicial | 505 kB (139 kB gzip) | 303 kB (95 kB gzip) |
| Pantallas | incluidas | 13–43 kB cada una (4–11 kB gzip) |

## Limitaciones conocidas

- La demo se sirve con `vite preview`, que no es un servidor de producción.
- `npm audit` informa 10 avisos moderados **solo en herramientas de desarrollo**: `minimatch` 10 a través de ESLint y typescript-eslint, una denegación de servicio con patrones glob maliciosos.
  - No afecta al código que llega al navegador: `npm audit --omit=dev` da 0.
  - La corrección es `minimatch` 11, una versión mayor muy reciente que esas herramientas aún no adoptan.
- Sin un segundo dispositivo no se puede recuperar una cuenta cuyo token se perdió (es una limitación del backend; ver el README principal).
