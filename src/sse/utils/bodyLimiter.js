// Body size limiter — rejects requests with bodies exceeding the configured max.
// Prevents OOM/DoS via oversized request bodies before JSON parsing.
//
// Usage:
//   const body = await readBodyWithLimit(request, 10 * 1024 * 1024); // 10 MB
//   const data = JSON.parse(body);

const DEFAULT_MAX_BODY = 10 * 1024 * 1024; // 10 MB

/**
 * Read the request body as a string, rejecting if it exceeds maxBytes.
 * Checks Content-Length header first (fast reject), then streams with a cap.
 *
 * @param {Request} request
 * @param {number} maxBytes - maximum body size in bytes (default: 10 MB)
 * @returns {Promise<string>} body as string
 * @throws {Error} if body exceeds limit
 */
export async function readBodyWithLimit(request, maxBytes = DEFAULT_MAX_BODY) {
  // Fast path: check Content-Length header
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > maxBytes) {
    throw new Error(`Request body too large: ${contentLength} bytes exceeds ${maxBytes} byte limit`);
  }

  // Stream path: read with accumulation + cap
  const reader = request.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let received = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > maxBytes) {
      try { reader.cancel(); } catch {}
      throw new Error(`Request body too large: exceeds ${maxBytes} byte limit`);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode(); // flush

  return body;
}
