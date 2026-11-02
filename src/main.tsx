import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toasts";
import { applyTheme, themeFromStorage } from "./lib/theme";
import "./styles.css";

// apply the stored theme before the first paint so the shell never flashes
applyTheme(themeFromStorage());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
