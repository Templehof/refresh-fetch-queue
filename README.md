# Refresh Fetch Queue 🔄

A robust, concurrency-safe fetch interceptor for handling JWT token refresh, request queuing, and retries.

[![npm version](https://img.shields.io/npm/v/refresh-fetch-queue.svg)](https://www.npmjs.com/package/refresh-fetch-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **🛡️ Concurrency Safe:** Handles multiple simultaneous 401 errors by queuing requests and triggering only **one** refresh.
- **⚡ Stale Token Protection:** Automatically detects if a token was refreshed while a request was in-flight and retries immediately without hitting the backend.
- **⏱️ Timeout Protection:** Prevents infinite hanging with a configurable safety timeout (default 4s).
- **📦 Agnostic:** Works with Redux, Zustand, Context, or vanilla JS. Zero dependencies on specific state managers.
- **💉 Dependency Injection:** Fully testable architecture using a configuration object pattern.
- **✅ Universal:** Gracefully handles public endpoints (no token) and authenticated endpoints alike.

## Installation

```bash
npm install refresh-fetch-queue
```

## Usage

This library is designed to be a **singleton**. You instantiate it once, passing in your specific logic for getting/setting tokens and logging out.

### 1. Initialize the Interceptor

Create a file (e.g., `api.ts` or `interceptor.ts`) and configure your instance.

```typescript
import { FetchInterceptor } from "refresh-fetch-queue";
import { useAuthStore } from "./your-auth-store"; // Example: Zustand

// Define your specific logic for the library to use
export const api = new FetchInterceptor({
  // 1. How to get the current token (return null if not logged in)
  getToken: () => useAuthStore.getState().accessToken,

  // 2. How to save the new token after a refresh
  setToken: (newToken) => useAuthStore.setState({ accessToken: newToken }),

  // 3. The actual async function to call your backend refresh endpoint
  refreshToken: async () => {
    const response = await fetch("/api/auth/refresh", { method: "POST" });
    if (!response.ok) throw new Error("Refresh failed");
    const data = await response.json();
    return data.accessToken; // Must return the new token string
  },

  // 4. What to do if refresh fails completely (e.g. logout user)
  onAuthFailure: () => {
    useAuthStore.getState().logout();
    window.location.href = "/login";
  },

  // Optional: Timeout in ms (default 4000)
  refreshTimeoutMs: 10000,
});
```

### 2. Use it in your API calls

The interceptor exposes a `.fetch()` method that mirrors the native `window.fetch` signature.

```typescript
// user-service.ts
import { api } from "./api";

export const getUserProfile = async () => {
  try {
    // This call is now protected!
    // It will auto-attach the token, handle 401s, queue, refresh, and retry.
    const response = await api.fetch("/api/profile", {
      method: "GET",
    });

    return response.json();
  } catch (error) {
    console.error("Request failed", error);
  }
};
```

## How It Works

1.  **Interception:** Every request goes through the wrapper. It injects the `Authorization: Bearer ...` header if a token exists.
2.  **401 Detection:** If a request fails with `401 Unauthorized`, the interceptor pauses that request and adds it to a **Queue**.
3.  **Concurrency Lock:** If multiple requests fail simultaneously, the first one triggers the refresh. Subsequent failures are simply queued.
4.  **Refresh & Retry:** Once the new token is obtained, the queue is flushed. All paused requests are automatically retried with the **new token**.
5.  **Failure:** If the refresh fails (or times out), the queue is rejected, and `onAuthFailure` is triggered to log the user out.

## API Reference

### Configuration Object

| Property           | Type                      | Required | Description                                                                      |
| :----------------- | :------------------------ | :------: | :------------------------------------------------------------------------------- |
| `getToken`         | `() => string \| null`    |    ✅    | Callback to retrieve the current access token. Return `null` if unauthenticated. |
| `setToken`         | `(token: string) => void` |    ✅    | Callback to save the new token to your store/storage.                            |
| `refreshToken`     | `() => Promise<string>`   |    ✅    | Async function that calls your backend. Must return the new token string.        |
| `onAuthFailure`    | `() => void`              |    ✅    | Callback triggers when refresh fails or times out. Use this to logout.           |
| `refreshTimeoutMs` | `number`                  |    ❌    | Time in ms before the refresh is considered failed. Defaults to `4000`.          |

## License

MIT
