/** Permite a las pantallas pedir que se vuelva a contar las solicitudes pendientes (barra lateral). */

import { createContext, useContext } from "react";

export const PendingCountContext = createContext<() => void>(() => undefined);

export function useRefreshPendingCount(): () => void {
  return useContext(PendingCountContext);
}
