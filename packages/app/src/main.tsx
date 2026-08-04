import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { reportRuntimeError } from "./data/runtime-diagnostics";
import "./i18n";
import "./styles.css";

document.documentElement.dataset.runtime = window.__TAURI_INTERNALS__
  ? "tauri"
  : "browser";

if (import.meta.env.VITE_DEBRIEF_DEMO === "1") {
  const requestedTheme = new URLSearchParams(window.location.search).get("theme");
  if (requestedTheme === "light" || requestedTheme === "dark") {
    document.documentElement.dataset.theme = requestedTheme;
  }
}

window.addEventListener("error", (event) => {
  reportRuntimeError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  reportRuntimeError(event.reason);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
