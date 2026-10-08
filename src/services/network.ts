/**
 * Network helper providerFetch
 * Tries direct browser call first; on network/CORS TypeError, retries once through /api/proxy.
 */

export interface ProviderFetchOptions extends RequestInit {
  providerName?: string;
  timeoutMs?: number;
}

export async function providerFetch(url: string, init: ProviderFetchOptions = {}): Promise<Response> {
  const { providerName = 'provider', timeoutMs = 60000, ...fetchInit } = init;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error("You're offline. Check your internet connection.");
  }

  // Create timeout controller
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  // Link caller signal if provided
  if (init.signal) {
    init.signal.addEventListener('abort', () => {
      timeoutController.abort();
    });
  }

  const effectiveInit: RequestInit = {
    ...fetchInit,
    signal: timeoutController.signal,
  };

  try {
    const directResponse = await fetch(url, effectiveInit);
    clearTimeout(timer);
    return directResponse;
  } catch (err: any) {
    if (timedOut) {
      clearTimeout(timer);
      throw new Error(`No response from ${providerName}. Try again.`);
    }

    // User aborted
    if (init.signal?.aborted) {
      clearTimeout(timer);
      throw err;
    }

    // Check if network / CORS error (TypeError in browser)
    const isNetworkOrCors = err instanceof TypeError || err.name === 'TypeError';
    if (!isNetworkOrCors) {
      clearTimeout(timer);
      throw err;
    }

    // Retry once via /api/proxy
    try {
      const proxyHeaders = new Headers(effectiveInit.headers || {});
      proxyHeaders.set('x-target-url', url);

      const proxyInit: RequestInit = {
        ...effectiveInit,
        headers: proxyHeaders,
      };

      const proxyResponse = await fetch('/api/proxy', proxyInit);
      clearTimeout(timer);

      if (proxyResponse.status === 404) {
        // Proxy not available
        throw new Error(
          `Couldn't reach ${providerName}. Check your internet connection. If this keeps happening, the server may be waking up; wait 30-60 seconds and retry.`
        );
      }

      return proxyResponse;
    } catch (proxyErr: any) {
      clearTimeout(timer);
      if (init.signal?.aborted) throw proxyErr;

      throw new Error(
        `Couldn't reach ${providerName}. Check your internet connection. If this keeps happening, the server may be waking up; wait 30-60 seconds and retry.`
      );
    }
  }
}
