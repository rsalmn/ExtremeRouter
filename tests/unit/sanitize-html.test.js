/**
 * Adversarial self-check for the DOMPurify-based sanitizeHtml.
 *
 * Asserts that attack vectors which bypassed the previous regex-based
 * sanitizer are now neutralized. Run with: node tests/unit/sanitize-html.test.js
 * (or as a plain script — it throws on failure, prints PASS on success).
 *
 * Note: DOMPurify requires a DOM. Under Node we provide one via jsdom if
 * available; the test harness (vitest with environment:'jsdom') supplies it
 * automatically. When run as a bare script without jsdom we skip gracefully.
 */

let sanitizeHtml;
let skipped = false;

try {
  // Prefer a real browser-like DOM if the harness provides one (vitest jsdom).
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    let JSDOM;
    try {
      ({ JSDOM } = await import("jsdom"));
    } catch {
      skipped = true;
      console.log("SKIP: jsdom not available — install jsdom or run under vitest with environment 'jsdom'.");
    }
    if (!skipped) {
      const dom = new JSDOM("<!doctype html><html><body></body></html>");
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.DOMParser = dom.window.DOMParser;
    }
  }
  if (!skipped) {
    ({ sanitizeHtml } = await import("../../src/shared/utils/sanitizeHtml.js"));
  }
} catch (err) {
  console.error("SETUP FAIL:", err.message);
  process.exit(1);
}

if (!skipped) {
  const cases = [
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

  let failures = 0;
  for (const [name, input, isSafe] of cases) {
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

  console.log(failures === 0 ? `\n✅ ALL ${cases.length} CASES PASS` : `\n❌ ${failures}/${cases.length} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
