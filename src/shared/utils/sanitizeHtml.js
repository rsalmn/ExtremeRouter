// Minimal HTML sanitizer for rendering model output as markdown.
//
// This is DEFENSE-IN-DEPTH, not a primary security control. The primary
// defense is that `marked` produces a constrained AST (code blocks are
// escaped text, not raw HTML by default). This sanitizer catches residual
// dangerous markup that could slip through (e.g. raw HTML embedded in
// markdown, or a future marked config change that allows raw HTML).
//
// It is deliberately conservative and regex-based to avoid pulling in a
// heavyweight DOM-parser dependency. It strips:
//   - <script>, <iframe>, <object>, <embed>, <form>, <style> elements entirely
//   - on* event-handler attributes (onclick, onerror, ...)
//   - javascript: / vbscript: / data:text/html URLs in href/src
//
// For untrusted model output this is acceptable; if you ever need to render
// arbitrary untrusted HTML from a non-markdown source, use a real DOM parser
// (DOMPurify) instead.

const DANGEROUS_TAGS = /<\/?(script|iframe|object|embed|form|style|link|meta|base|applet)\b[^>]*>/gi;
const EVENT_HANDLER_ATTRS = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL_SCHEMES = /(href|src|xlink:href)\s*=\s*("(?:javascript|vbscript|data:text\/html)[^"]*"|'(?:javascript|vbscript|data:text\/html)[^']*')/gi;

/**
 * Sanitize an HTML string produced by a markdown parser.
 * @param {string} html
 * @returns {string} sanitized HTML, safe for dangerouslySetInnerHTML
 */
export function sanitizeHtml(html) {
  if (typeof html !== "string" || html.length === 0) return "";
  return html
    .replace(DANGEROUS_TAGS, "")
    .replace(EVENT_HANDLER_ATTRS, "")
    .replace(DANGEROUS_URL_SCHEMES, "");
}
