/**
 * A callback that resolves or rejects a paused request.
 */
export type QueueCallback = (error: Error | null, token?: string) => void;

/**
 * Function to retrieve the current access token.
 * Should return null/undefined if no token exists.
 */
export type TokenProvider = () => string | null | undefined;

/**
 * Function to update the token in your storage (Zustand, LocalStorage, etc).
 */
export type TokenUpdater = (newToken: string) => void;

/**
 * Async function to request a new token from the backend.
 */
export type RefreshHandler = () => Promise<string>;

/**
 * Callback triggered when refresh fails completely (e.g. for logging out in the UI).
 */
export type AuthFailureHandler = () => void;

/**
 * The configuration object for initializing the interceptor.
 */
export interface FetchInterceptorConfig {
  getToken: TokenProvider;
  setToken: TokenUpdater;
  refreshToken: RefreshHandler;
  onAuthFailure: AuthFailureHandler;
  /**
   * Optional: Custom timeout for the refresh operation. Defaults to 4000ms.
   */
  refreshTimeoutMs?: number;
}
