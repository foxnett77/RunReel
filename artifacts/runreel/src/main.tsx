import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Service Worker: register + auto-update ────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", {
        // Always fetch the SW file from network — never rely on HTTP cache
        updateViaCache: "none",
      })
      .then((reg) => {
        // When a new SW is found, track its state
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            // "activated" + there was already a controller = update, not first install
            if (
              newWorker.state === "activated" &&
              navigator.serviceWorker.controller
            ) {
              window.location.reload();
            }
          });
        });

        // Also check for updates immediately (in case SW was already waiting)
        reg.update().catch(() => {});
      })
      .catch(() => {
        // Service worker registration failed silently
      });

    // Reload when the active SW controller changes (new SW took over)
    // Guard against loop: only reload once
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
