/**
 * Adversarial self-check for the DOMPurify-based sanitizeHtml.
 *
 * Asserts that attack vectors which bypassed the previous regex-based
 * sanitizer are now neutralized. Run under vitest:
 *   npx vitest run tests/unit/sanitize-html.test.js
 * Or as a plain script (no vitest):
 *   node tests/unit/sanitize-html.test.js
 *
 * DOMPurify requires a DOM. Under vitest with environment:'jsdom' the harness
 * supplies one; the project's vitest config uses environment:'node', so this
 * file bootstraps jsdom itself before importing sanitizeHtml. When run as a
 * bare script without jsdom we skip gracefully.
 *
 * Dual-mode: when vitest globals (describe/it/expect) are present the cases
 * are registered through the framework so failures surface in the test
 * report. Otherwise we fall back to a console-driven runner that still
 * reports every case and exits non-zero on failure.
 */

const CASES = [
  // [name, input, predicate(out) => true if SAFE]
  ["strips <script>", '<p>hi</p><script>alert(1)</script>', (o) => !o.includes("<script")],
  // Nested-tag evasion: safe if no executable markup remains. The alert text
  // surviving as inert, HTML-encoded plain text is correct behavior.
  ["blocks nested-tag bypass <scr<script>ipt>", "<scr<script>ipt>alert(1)</scr</script>ipt>", (o) => !/<script/i.test(o) && !/<[a-z]+[^>]*on\w+=/i.test(o)],
  ["strips onerror handler", '<img src=x onerror="alert(1)">', (o) => !/onerror/i.test(o)],
  ["strips unquoted onerror", "<img src=x onerror=alert(1)>", (o) => !/onerror/i.test(o)],
  ["strips entity-encoded handler", '<img src=x &#111;nerror="alert(1)">', (o) => !/onerror=/i.test(o)],
  ["strips onclick on div", '<div onclick="alert(1)">x</div>', (o) => !/onclick/i.test(o)],
  ["blocks javascript: href", '<a href="javascript:alert(1)">x</a>', (o) => !/javascript:/i.test(o)],
  ["blocks entity-encoded javascript:", '<a href="&#106;avascript:alert(1)">x</a>', (o) => !/javascript:/i.test(o)],
  ["blocks vbscript:", '<a href="vbscript:msgbox(1)">x</a>', (o) => !/vbscript:/i.test(o)],
  ["blocks svg data: in img src", '<img src="data:image/svg+xml,<svg onload=alert(1)>">', (o) => !/onload/i.test(o) && !/svg/i.test(o)],
  ["keeps raster data: images", '<img src="data:image/png;base64,iVBORw0KGgo=">', (o) => /data:image\/png/.test(o)],
  ["strips <style> tag", '<style>body{background:url(http://evil)}</style><p>x</p>', (o) => !/<style/i.test(o)],
  ["strips style attribute", '<p style="background:url(javascript:alert(1))">x</p>', (o) => !/style=/i.test(o)],
  ["strips <form>", '<form action="http://evil"><input name=p></form>', (o) => !/<form/i.test(o) && !/<input/i.test(o)],
  ["strips <iframe>", '<iframe src="http://evil"></iframe>', (o) => !/<iframe/i.test(o)],
  ["strips <object>", '<object data="http://evil"></object>', (o) => !/<object/i.test(o)],
  ["strips <svg onload>", '<svg onload="alert(1)"><circle/></svg>', (o) => !/onload/i.test(o) && !/alert\(1\)/.test(o)],
  ["adds noopener to links", '<a href="https://ok.example">x</a>', (o) => /rel="noopener noreferrer"/.test(o) && /target="_blank"/.test(o)],
  ["keeps safe markdown html", '<p>Hello <strong>world</strong></p>', (o) => o.includes("<strong>world</strong>")],
  ["keeps code blocks", '<pre><code class="language-js">const a = 1;</code></pre>', (o) => o.includes("const a = 1;")],
  ["empty string safe", "", (o) => o === ""],
  ["non-string safe", null, (o) => o === ""],
];

// --- Bootstrap a DOM for DOMPurify if the host doesn't already provide one --
async function loadSanitizeHtml() {
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    let JSDOM;
    try {
      ({ JSDOM } = await import("jsdom"));
    } catch {
      return { skipped: true, reason: "jsdom not available — install jsdom or run under vitest with environment 'jsdom'." };
    }
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.DOMParser = dom.window.DOMParser;
  }
  const { sanitizeHtml } = await import("../../src/shared/utils/sanitizeHtml.js");
  return { sanitizeHtml, skipped: false };
}

// --- vitest path: register cases through the framework -----------------------
// Detect vitest by checking for its globals (config sets globals:true). Using
// dynamic property lookup keeps this file loadable in plain-node mode too.
const vitestDescribe = globalThis.describe;
const vitestIt = globalThis.it;
const vitestExpect = globalThis.expect;
const vitestBeforeAll = globalThis.beforeAll;
const isVitest =
  typeof vitestDescribe === "function" &&
  typeof vitestIt === "function" &&
  typeof vitestExpect === "function";

if (isVitest) {
  vitestDescribe("sanitizeHtml (DOMPurify-based)", () => {
    // Hoist the resolved sanitizeHtml into a closure the test cases can read.
    // Top-level await in the describe body isn't supported uniformly across
    // vitest versions, so we resolve it in a beforeAll hook.
    let sanitizeHtml = null;
    let setupError = null;

    // beforeAll is a global under vitest's globals:true config. Guard the call
    // so the file still loads if a future vitest version drops it.
    if (typeof vitestBeforeAll === "function") {
      vitestBeforeAll(async () => {
        try {
          const r = await loadSanitizeHtml();
          sanitizeHtml = r.sanitizeHtml || null;
        } catch (err) {
          setupError = err;
        }
      });
    }

    vitestIt.each(CASES)("%s", async (_name, input, isSafe) => {
      // Lazy fallback if beforeAll never ran (e.g. vitest version mismatch):
      // load on first use. Subsequent calls reuse the cached result.
      if (!sanitizeHtml && !setupError) {
        const r = await loadSanitizeHtml();
        sanitizeHtml = r.sanitizeHtml || null;
      }
      if (setupError) throw setupError;
      if (!sanitizeHtml) {
        // jsdom unavailable — record as skipped rather than masking as pass.
        vitestExpect(sanitizeHtml, "jsdom unavailable; sanitizeHtml did not load").toBeTruthy();
        return;
      }
      const out = sanitizeHtml(input);
      vitestExpect(isSafe(out)).toBe(true);
    });
  });
} else {
  // --- standalone-script path: console runner with full case reporting -----
  (async () => {
    try {
      const { sanitizeHtml, skipped, reason } = await loadSanitizeHtml();
      if (skipped) {
        console.log("SKIP:", reason);
        process.exit(0);
      }

      let failures = 0;
      for (const [name, input, isSafe] of CASES) {
        let out;
        try {
          out = sanitizeHtml(input);
        } catch (err) {
          console.log(`FAIL  ${name} — threw: ${err.message}`);
          failures++;
          continue;
        }
        if (isSafe(out)) {
          console.log(`PASS  ${name}`);
        } else {
          console.log(`FAIL  ${name}\n      in : ${JSON.stringify(input)}\n      out: ${JSON.stringify(out)}`);
          failures++;
        }
      }

      console.log(failures === 0 ? `\n✅ ALL ${CASES.length} CASES PASS` : `\n❌ ${failures}/${CASES.length} FAILURES`);
      process.exit(failures === 0 ? 0 : 1);
    } catch (err) {
      console.error("SETUP FAIL:", err.message);
      process.exit(1);
    }
  })();
}
