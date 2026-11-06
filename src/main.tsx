import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toasts";
import { applyTheme, themeFromStorage } from "./lib/theme";
import "./styles.css";

// apply the stored theme before the first paint so the shell never flashes
applyTheme(themeFromStorage());

// the hand-rolled boot screen in index.html has done its job (window is never
// blank); lift it off exactly as React hands back the first frame
document.getElementById("boot")?.remove();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
