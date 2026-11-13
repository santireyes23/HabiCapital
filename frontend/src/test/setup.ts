import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Las pantallas se cargan en diferido (React.lazy): la primera importación de cada archivo de
// prueba puede tardar más de 1 s con la máquina o el CI ocupados. 3 s evita falsos fallos.
configure({ asyncUtilTimeout: 3_000 });

afterEach(() => {
  cleanup();
});
