// HuggingChat — web-cookie reverse of the Hugging Face consumer chat app
// (huggingface.co/chat).
//
// STATUS: ANTI-BOT — HuggingFace sits behind AWS WAF (CloudFront) which requires
// a JavaScript-challenge-solved `aws-waf-token` cookie bound to the browser's TLS
// fingerprint. Node.js fetch (even with TLS impersonation) cannot solve the JS
// challenge or match the browser fingerprint. Requests return an HTML challenge
// page instead of the API JSON response. A headless browser (Playwright/Puppeteer)
// integration would be needed to bypass this — tracked as a future project.
//
// The executor code is fully functional for when the WAF challenge is solved
// (e.g. via browser-backed chat). The model catalog is kept for reference.
export default {
  id: "huggingchat",
  priority: 60,
  alias: "huggingchat",
  aliases: [
    "hc-web",
  ],
  uiAlias: "huggingchat",
  display: {
    name: "HuggingChat (Web)",
    icon: "smart_toy",
    color: "#FFD21E",
    textIcon: "HC",
    website: "https://huggingface.co/chat",
    notice: {
      signupUrl: "https://huggingface.co/chat",
      apiKeyUrl: "https://huggingface.co/chat",
      text: "⚠️ ANTI-BOT: HuggingFace is behind AWS WAF which blocks non-browser requests. Even with valid cookies (hf-chat + token + aws-waf-token), server-side requests are rejected. This provider may not work until a headless browser integration is added. Consider using HuggingFace Inference API (API key) as an alternative.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  comingSoon: true,
  authHint: "Paste the FULL cookie string from huggingface.co/chat. Note: AWS WAF may block server-side requests regardless of cookie validity.",
  transport: {
    // Base of the HuggingChat web API. The executor builds full per-call URLs from this.
    baseUrl: "https://huggingface.co",
    format: "huggingchat",
    authType: "cookie",
  },
  // Catalog mirrored from OmniRoute's HuggingChat production shortlist. HuggingChat
  // routes by the model id passed to POST /chat/conversation, so each entry's id is
  // the upstream model id verbatim. Vision/tool/reasoning capabilities are not
  // surfaced here (plain text chat only).
  models: [
    { id: "baidu/ERNIE-4.5-VL-424B-A47B-Base-PT", name: "ERNIE 4.5 VL 424B A47B Base PT" },
    { id: "CohereLabs/c4ai-command-r7b-12-2024", name: "Command R7B 12-2024" },
    { id: "CohereLabs/command-a-reasoning-08-2025", name: "Command A Reasoning 08-2025" },
    { id: "CohereLabs/command-a-vision-07-2025", name: "Command A Vision 07-2025" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "google/gemma-4-31B-it", name: "Gemma 4 31B" },
    { id: "google/gemma-4-26B-A4B-it", name: "Gemma 4 26B A4B" },
    { id: "inclusionAI/Ling-2.6-1T", name: "Ling 2.6 1T" },
    { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", name: "Llama 4 Scout 17B 16E Instruct" },
    { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama 4 Maverick 17B 128E Instruct FP8" },
    { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3" },
    { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4", name: "NVIDIA Nemotron 3 Ultra 550B A55B NVFP4" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
    { id: "Qwen/Qwen3.5-122B-A10B", name: "Qwen3.5 122B A10B" },
    { id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B" },
    { id: "Qwen/Qwen3.6-27B", name: "Qwen3.6 27B" },
    { id: "Qwen/Qwen3.6-35B-A3B", name: "Qwen3.6 35B A3B" },
    { id: "stepfun-ai/Step-3.7-Flash", name: "Step 3.7 Flash" },
    { id: "XiaomiMiMo/MiMo-V2.5-Pro", name: "MiMo V2.5 Pro" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
  ],
  passthroughModels: true,
};
