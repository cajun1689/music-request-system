import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// amazon-cognito-identity-js expects Node-like globals in some code paths.
if (typeof window !== "undefined") {
  (window as Window & { global?: Window }).global ??= window;
  (window as Window & { process?: { env: Record<string, string> } }).process ??= { env: {} };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
