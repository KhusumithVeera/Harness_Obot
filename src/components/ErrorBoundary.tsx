import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('Unhandled app error:', error, errorInfo);
  }

  handleCopyDetails = () => {
    const { error, errorInfo } = this.state;
    // Sanitize any potential secrets from the string
    let details = `Error: ${error?.name}: ${error?.message}\n\nStack:\n${error?.stack || ''}\n\nComponent Stack:\n${
      errorInfo?.componentStack || ''
    }`;

    // Redact password or key-like tokens
    details = details.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
    details = details.replace(/password=[^&\s]+/gi, 'password=[REDACTED]');

    navigator.clipboard.writeText(details);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0B0F19] flex items-center justify-center p-6 text-[#111827] dark:text-[#F3F4F6] font-sans">
          <div className="max-w-md w-full bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xl text-center">
            <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
              <AlertOctagon className="w-6 h-6" />
            </div>

            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              An unexpected error occurred. You can reload the app or copy the error details for inspection.
            </p>

            <div className="text-left bg-gray-50 dark:bg-gray-900/80 p-3 rounded-lg border border-gray-200 dark:border-gray-800 text-xs font-mono text-gray-700 dark:text-gray-300 max-h-36 overflow-auto mb-6 break-words">
              {this.state.error?.message || 'Unknown error'}
            </div>

            <div className="flex items-center gap-3 justify-center">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-sm cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Reload
              </button>

              <button
                type="button"
                onClick={this.handleCopyDetails}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition cursor-pointer"
              >
                {this.state.copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy error details
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
