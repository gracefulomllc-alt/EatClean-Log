import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Chrome offers "install" through this event. Hold onto it so Setup can show an Install button.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event("cutlog:installable"));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
