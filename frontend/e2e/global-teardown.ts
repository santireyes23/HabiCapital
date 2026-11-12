import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Al terminar: invariantes del ledger directamente en habicapital_test (suma de saldos 0,
 * asientos cuadrados, saldos = suma de asientos, ninguno negativo, solicitudes aceptadas con
 * exactamente una transacción). Si algo se duplicó, aquí falla.
 */
export default function globalTeardown() {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  execFileSync("uv", ["run", "python", "frontend/e2e/backend.py", "check"], { cwd: root, stdio: "inherit" });
}
