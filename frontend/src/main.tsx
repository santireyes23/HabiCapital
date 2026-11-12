import "@fontsource-variable/manrope";
import "./styles/theme.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { api, idempotency, tokenStore } from "./api";
import App from "./App";

const root = document.getElementById("root");
if (root === null) throw new Error("Falta el elemento #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App api={api} tokenStore={tokenStore} idempotency={idempotency} />
    </BrowserRouter>
  </StrictMode>,
);
