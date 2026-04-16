import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// amazon-cognito-identity-js expects Node-like globals in some code paths.
if (typeof window !== "undefined") {
  (window as Window & { global?: Window }).global ??= window;
  (window as Window & { process?: { env: Record<string, string> } }).process ??= { env: {} };
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <App />
          <Toaster
            position="top-center"
            theme="dark"
            toastOptions={{
              style: { background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0" },
            }}
          />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
