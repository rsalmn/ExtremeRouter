// QwenCloud — Alibaba/Qwen consumer web chat (www.qwencloud.com).
//
// QwenCloud provides access to Qwen models (qwen3.7-plus, qwen3.7-max) via
// a multi-step auth flow:
//   1. Cookie auth (login_qwencloud_ticket)
//   2. secToken from user/info.json
//   3. accessToken from cs-data.qwencloud.com (requires bx-ua/bx-umidtoken anti-bot headers)
//   4. Chat via SSE at cs-stream.qwencloud.com/sse/console4Json/{accessToken}
//
// The QwenCloudExecutor handles this flow, caching accessToken per session.
//
// Auth input: user pastes cookie + bx-ua + bx-umidtoken from DevTools.
// Format: "cookie=<full_cookie>; bx-ua=<bx_ua_value>; bx-umidtoken=<umidtoken_value>"
// Or just the cookie — accessToken generation will fail gracefully and retry.
export default {
  id: "qwencloud",
  priority: 65,
  alias: "qc",
  aliases: ["qwencloud"],
  uiAlias: "qc",
  display: {
    name: "QwenCloud",
    icon: "cloud",
    color: "#615CED",
    textIcon: "QC",
    website: "https://www.qwencloud.com",
    notice: {
      signupUrl: "https://www.qwencloud.com",
      apiKeyUrl: "https://www.qwencloud.com",
      text: "QwenCloud provides access to Qwen 3.7 models via web chat. Log in at qwencloud.com, open the chat at qwencloud.com/try-ai/chat?models=qwen3.7-max, then copy the FULL Cookie string + bx-ua + bx-umidtoken from DevTools. The executor handles the multi-step auth flow automatically.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your cookie string from qwencloud.com (must include login_qwencloud_ticket). Optionally append: ; bx-ua=<value>; bx-umidtoken=<value> for accessToken generation.",
  transport: {
    baseUrl: "https://cs-stream.qwencloud.com/sse/console4Json",
    format: "qwencloud",
    authType: "cookie",
  },
  models: [
    { id: "qwen3.7-max", name: "Qwen 3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus" },
  ],
  passthroughModels: true,
};
