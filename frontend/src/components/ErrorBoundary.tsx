import { Component, type ErrorInfo, type ReactNode } from "react";
import { Sentry } from "../sentry";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App runtime error:", error, info.componentStack);
    try {
      Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack ?? "" } } });
    } catch {
      /* ignore Sentry failures */
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
          <div className="w-full max-w-2xl rounded-xl border border-rose-500/50 bg-slate-900 p-5">
            <h1 className="text-xl font-bold text-rose-300">App Error</h1>
            <p className="mt-2 text-sm text-slate-300">
              The interface hit a runtime error. Refresh this page. If it continues, share this message:
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-black/40 p-3 text-xs text-rose-200">
              {this.state.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
