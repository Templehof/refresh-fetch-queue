import { FetchInterceptor } from "./index";

const mockFetch = jest.fn();
global.fetch = mockFetch;

if (typeof window !== "undefined") {
  window.fetch = mockFetch;
}

describe("FetchInterceptor", () => {
  let interceptor: FetchInterceptor;

  let mockSetToken: jest.Mock;
  let mockGetToken: jest.Mock;
  let mockRefreshToken: jest.Mock;
  let mockOnFailure: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockSetToken = jest.fn();
    mockGetToken = jest.fn(() => "token-A");
    mockRefreshToken = jest.fn();
    mockOnFailure = jest.fn();

    interceptor = new FetchInterceptor({
      getToken: mockGetToken,
      setToken: mockSetToken,
      refreshToken: mockRefreshToken,
      onAuthFailure: mockOnFailure,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const getLastHeaders = (): Headers => {
    const lastCall = mockFetch.mock.lastCall;
    const options = lastCall[1];
    return options.headers as Headers;
  };

  test("should attach the access token to headers", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await interceptor.fetch("/api/test", { method: "GET" });

    const headers = getLastHeaders();
    expect(mockFetch).toHaveBeenCalledWith("/api/test", expect.anything());
    expect(headers.get("Authorization")).toBe("Bearer token-A");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("should handle 401, queue requests, refresh token, and retry", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    mockRefreshToken.mockResolvedValueOnce("token-B");
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true });

    const promise = interceptor.fetch("/api/test", { method: "GET" });

    await Promise.resolve();

    expect(mockRefreshToken).toHaveBeenCalled();

    await promise;

    expect(mockSetToken).toHaveBeenCalledWith("token-B");

    const headers = getLastHeaders();
    expect(headers.get("Authorization")).toBe("Bearer token-B");
  });

  test("Concurrency: Multiple 401s should trigger only ONE refresh", async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 401 }) // Req 1
      .mockResolvedValueOnce({ status: 401 }) // Req 2
      .mockResolvedValueOnce({ status: 200 }) // Retry 1
      .mockResolvedValueOnce({ status: 200 }); // Retry 2

    mockRefreshToken.mockResolvedValueOnce("token-B");

    const req1 = interceptor.fetch("/1");
    const req2 = interceptor.fetch("/2");

    await Promise.all([req1, req2]);

    expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockSetToken).toHaveBeenCalledWith("token-B");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  test("Stale Token Optimization: Should retry immediately if token changed while in flight", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    mockFetch.mockResolvedValueOnce({ status: 200 });

    mockGetToken.mockReturnValueOnce("token-A").mockReturnValueOnce("token-B");

    await interceptor.fetch("/api/late");

    expect(mockRefreshToken).not.toHaveBeenCalled();

    const headers = getLastHeaders();
    expect(headers.get("Authorization")).toBe("Bearer token-B");
  });

  test("Timeout: Should trigger failure if refresh hangs", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    mockRefreshToken.mockReturnValue(new Promise(() => {})); // Hangs

    const requestPromise = interceptor.fetch("/hang");

    const assertionPromise = expect(requestPromise).rejects.toThrow(
      "Token refresh operation timed out",
    );

    await jest.advanceTimersByTimeAsync(4001);

    await assertionPromise;
    expect(mockOnFailure).toHaveBeenCalled();
  });

  test("Queue Logic: Request made WHILE refreshing should wait in queue", async () => {
    (interceptor as any).isRefreshing = true;

    const queuePromise = interceptor.fetch("/queued");

    expect(mockFetch).not.toHaveBeenCalled();

    (interceptor as any).setToken("token-C");
    (interceptor as any).processQueue(null, "token-C");

    await queuePromise;

    const headers = getLastHeaders();
    expect(headers.get("Authorization")).toBe("Bearer token-C");
  });

  test("Public Endpoint: Should allow request even if no token exists", async () => {
    mockGetToken.mockReturnValue(null);
    mockFetch.mockResolvedValueOnce({ status: 200 });

    await interceptor.fetch("/public");

    const headers = getLastHeaders();
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
