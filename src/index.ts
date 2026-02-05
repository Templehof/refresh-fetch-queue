import {
  FetchInterceptorConfig,
  QueueCallback,
  TokenProvider,
  TokenUpdater,
  RefreshHandler,
  AuthFailureHandler,
} from "./types";

export * from "./types";

export class FetchInterceptor {
  private readonly REFRESH_TIMEOUT_MS: number;
  private isRefreshing = false;
  private requestQueue: QueueCallback[] = [];

  private getToken: TokenProvider;
  private setToken: TokenUpdater;
  private refreshToken: RefreshHandler;
  private onAuthFailure: AuthFailureHandler;

  constructor(config: FetchInterceptorConfig) {
    this.getToken = config.getToken;
    this.setToken = config.setToken;
    this.refreshToken = config.refreshToken;
    this.onAuthFailure = config.onAuthFailure;
    this.REFRESH_TIMEOUT_MS = config.refreshTimeoutMs || 4000;
  }

  public async fetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const accessToken = this.getToken();
    const isFormData = options.body instanceof FormData;

    // 1. Prepare Headers
    const headers = new Headers(options.headers || {});

    // Only attach auth header if a token actually exists
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    // Auto-set JSON content type unless it's FormData (browser handles boundary)
    if (!isFormData && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const config: RequestInit = { ...options, headers };

    // 2. Queueing Logic (If refresh is already happening)
    if (this.isRefreshing) {
      return new Promise<Response>((resolve, reject) => {
        this.enqueueRequest((error, newToken) => {
          if (error) {
            reject(error);
          } else if (newToken) {
            // Update header with the NEW token
            headers.set("Authorization", `Bearer ${newToken}`);
            resolve(window.fetch(url, { ...config, headers }));
          }
        });
      });
    }

    // 3. Normal Request
    const response = await window.fetch(url, config);

    // 4. Handle 401 Unauthorized
    if (response.status === 401) {
      // Guard: If we are not logged in (no token), a 401 is expected.
      // Do not attempt refresh. Just return the 401.
      if (!accessToken) {
        return response;
      }

      const currentStoredToken = this.getToken();

      // Race Condition Check: Has the token changed while we were flying?
      if (currentStoredToken && accessToken !== currentStoredToken) {
        headers.set("Authorization", `Bearer ${currentStoredToken}`);
        return window.fetch(url, { ...config, headers });
      }

      // Queue this request
      const holdingPromise = new Promise<Response>((resolve, reject) => {
        this.enqueueRequest((error, newToken) => {
          if (error) {
            reject(error);
          } else if (newToken) {
            headers.set("Authorization", `Bearer ${newToken}`);
            resolve(window.fetch(url, { ...config, headers }));
          }
        });
      });

      // Trigger Refresh
      this.performRefresh();

      return holdingPromise;
    }

    return response;
  }

  private enqueueRequest(callback: QueueCallback) {
    this.requestQueue.push(callback);
  }

  private async performRefresh() {
    if (this.isRefreshing) return;

    this.isRefreshing = true;

    try {
      // Safety check: Do we even have a session?
      const currentToken = this.getToken();
      if (!currentToken) {
        // If we don't have a token, we can't really "refresh".
        // This usually means the user manually logged out or storage was cleared.
        throw new Error("No token found to refresh");
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Token refresh operation timed out"));
        }, this.REFRESH_TIMEOUT_MS);
      });

      // NO ARGUMENTS passed to refreshToken()
      const newToken = await Promise.race([
        this.refreshToken(),
        timeoutPromise,
      ]);

      this.setToken(newToken);
      this.processQueue(null, newToken);
    } catch (error) {
      this.processQueue(error as Error);
      this.onAuthFailure();
    } finally {
      this.isRefreshing = false;
    }
  }

  private processQueue(error: Error | null, token: string = "") {
    this.requestQueue.forEach((callback) => {
      callback(error, token);
    });
    this.requestQueue = [];
  }
}
