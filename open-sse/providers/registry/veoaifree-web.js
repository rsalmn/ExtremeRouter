// VeoAIFree Web — veoaifree.com free multi-tool reverse-adapter.
//
// Ported from OmniRoute's veoaifree-web executor. veoaifree.com is a WordPress media-generation
// site (NOT chat): the VeoAIFreeWebExecutor (open-sse/executors/veoaifree-web.js) routes an
// OpenAI-style chat request to the matching media tool — text-to-video, image-to-video, image
// generation, TTS, or prompt enhancement — by inspecting the model id / prompt.
//
// Auth: none required (the provider field is cookie-shaped only to fit the webCookie category).
// The executor scrapes a WordPress CSRF nonce from the homepage and POSTs to admin-ajax.php.
// Rate limited to ~6 requests/hour per IP.
export default {
  id: "veoaifree-web",
  priority: 150,
  alias: "veoaifree-web",
  aliases: [
    "veo-free",
  ],
  uiAlias: "veo-free",
  display: {
    name: "Veo AI Free",
    icon: "movie",
    color: "#10B981",
    textIcon: "VF",
    website: "https://veoaifree.com",
    notice: {
      signupUrl: "https://veoaifree.com",
      apiKeyUrl: "https://veoaifree.com",
      text: "Veo AI Free (veoaifree.com) — free multi-tool via WordPress AJAX: text-to-video, image generation, TTS, and prompt enhancement. No auth required. Intent is detected from the model id / prompt (e.g. models containing 'image'/'tts'/'enhance'). Limited to ~6 requests/hour per IP. Send the prompt as the last user message; optional system message can set aspect_ratio:/voice:/lang: hints. No connection key needed — paste any placeholder.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "No auth required — veoaifree.com is free. Paste any placeholder value (the key is ignored).",
  transport: {
    baseUrl: "https://veoaifree.com",
    format: "veoaifree-web",
    authType: "cookie",
  },
  models: [
    { id: "veo", name: "VEO 3.1" },
    { id: "seedance", name: "Seedance" },
  ],
  passthroughModels: true,
};
