import DOMPurify from "dompurify";

/**
 * Sanitize HTML produced from markdown before injecting via dangerouslySetInnerHTML.
 *
 * Uses DOMPurify — a battle-tested, browser-native DOM parser sanitizer.
 * The previous regex-based approach could be bypassed via nested tags
 * (`<scr<script>ipt>`), unquoted attributes, and entity-encoded handlers.
 * DOMPurify parses into a real DOM tree and rebuilds a clean serialization,
 * making those evasion classes structurally impossible.
 *
 * Output from an LLM is untrusted content: prompt injection can force a model
 * to emit hostile markup. This runs in an admin dashboard where XSS could
 * perform actions on behalf of the operator.
 *
 * Hardening applied:
 * - FORBID_TAGS: style (CSS exfil), form/input/textarea/button/select
 *   (credential harvesting UI), svg (can carry script even in data: URIs).
 * - FORBID_ATTR: style (inline CSS can url()-exfiltrate).
 * - ALLOW_DATA_ATTR false is default; data: URIs restricted below.
 * - Links get rel="noopener noreferrer" + target="_blank" via hook so
 *   model-rendered links can't tabnab or leak the dashboard URL as referrer.
 *
 * @param {string} html - Raw HTML string (typically from a markdown renderer).
 * @returns {string} Sanitized HTML safe for dangerouslySetInnerHTML.
 */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Deterministic data: URI policy — regex-based ALLOWED_URI_REGEXP is leaky
  // (its `[^a-z]` clause passes almost anything). Instead, strip any data:
  // attribute value that isn't an inert raster image. SVG deliberately
  // excluded: it can carry script/onload even inside a data: URI.
  for (const attr of ["src", "href", "xlink:href", "action", "formaction"]) {
    const val = node.getAttribute(attr);
    if (val && /^\s*data:/i.test(val) && !/^\s*data:image\/(?:png|jpe?g|gif|webp);/i.test(val)) {
      node.removeAttribute(attr);
    }
  }
});

const SANITIZE_CONFIG = {
  FORBID_TAGS: ["style", "form", "input", "textarea", "button", "select", "svg"],
  FORBID_ATTR: ["style"],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

export function sanitizeHtml(html) {
  if (typeof html !== "string" || !html) return "";
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
