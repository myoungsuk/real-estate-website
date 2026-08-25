const baseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function createRequestId() {
  return crypto.randomUUID();
}

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...baseHeaders,
      ...headers,
    },
  });
}

export function errorResponse({ code, message, details, requestId, status, retryable = false, headers = {} }) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        retryable,
        ...(Array.isArray(details) && details.length > 0 ? { details } : {}),
      },
      requestId,
    },
    {
      status,
      headers: {
        "X-Request-Id": requestId,
        ...headers,
      },
    },
  );
}
