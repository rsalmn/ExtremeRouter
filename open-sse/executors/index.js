import { AntigravityExecutor } from "./antigravity.js";
import { AzureExecutor } from "./azure.js";
import { GeminiCLIExecutor } from "./gemini-cli.js";
import { GithubExecutor } from "./github.js";
import { IFlowExecutor } from "./iflow.js";
import { QoderExecutor } from "./qoder.js";
import { KiroExecutor } from "./kiro.js";
import { KimchiExecutor } from "./kimchi.js";
import { CodexExecutor } from "./codex.js";
import { CursorExecutor } from "./cursor.js";
import { VertexExecutor } from "./vertex.js";
import { QwenExecutor } from "./qwen.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { GrokWebExecutor } from "./grok-web.js";
import { PerplexityWebExecutor } from "./perplexity-web.js";
import { OllamaLocalExecutor } from "./ollama-local.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { XiaomiMimoExecutor } from "./xiaomi-mimo.js";
import { MimoFreeExecutor } from "./mimo-free.js";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { ZaiWebExecutor } from "./zai-web.js";
import { GlmExecutor } from "./glm.js";
import { ZcodeExecutor } from "./zcode.js";
import { DefaultExecutor } from "./default.js";
import { DevinExecutor } from "./devin.js";
// Web-cookie providers (ported from OmniRoute)
import { DeepSeekWebExecutor } from "./deepseek-web.js";
import { QwenWebExecutor } from "./qwen-web.js";
import { KimiWebExecutor } from "./kimi-web.js";
import { BlackboxWebExecutor } from "./blackbox-web.js";
import { ZenmuxFreeExecutor } from "./zenmux-free.js";
import { ApiAirforceExecutor } from "./api-airforce.js";
import { FreeBuffWebExecutor } from "./freebuff-web.js";
import { FreeBuffExecutor } from "./freebuff.js";
import { InxorastudioWebExecutor } from "./inxorastudio-web.js";
import { OneMinExecutor } from "./onemin.js";
import { OneMinApiExecutor } from "./onemin-api.js";
import { MarathonExecutor } from "./marathon.js";
import { ZedExecutor } from "./zed.js";
import { AgnesWebExecutor } from "./agnes-web.js";
import { PerplexityAgentExecutor } from "./perplexity-agent.js";
import { QwenCloudExecutor } from "./qwencloud.js";
import { T3ChatWebExecutor } from "./t3-web.js";
import { DuckDuckGoWebExecutor } from "./duckduckgo-web.js";
import { VeniceWebExecutor } from "./venice-web.js";
import { DoubaoWebExecutor } from "./doubao-web.js";
import { V0VercelWebExecutor } from "./v0-vercel-web.js";
import { PoeWebExecutor } from "./poe-web.js";
import { CopilotWebExecutor } from "./copilot-web.js";
import { MuseSparkWebExecutor } from "./muse-spark-web.js";
import { AdaptaWebExecutor } from "./adapta-web.js";
import { VeoAIFreeWebExecutor } from "./veoaifree-web.js";
import { ClaudeWebExecutor } from "./claude-web.js";
import { ChatGptWebExecutor } from "./chatgpt-web.js";
import { GeminiWebExecutor } from "./gemini-web.js";
import { GeminiBusinessExecutor } from "./gemini-business.js";
import { HailuoWebExecutor } from "./hailuo-web.js";
import { InnerAiExecutor } from "./inner-ai.js";
import { ConolWebExecutor } from "./conol-web.js";
import { NotionWebExecutor } from "./notion-web.js";
import { HyperAgentExecutor } from "./hyperagent.js";
// Web-cookie providers (ported from OmniRoute — batch 2)
import { HuggingChatExecutor } from "./huggingchat.js";
import { LMArenaExecutor } from "./lmarena.js";
import { PuterExecutor } from "./puter.js";
import { PollinationsExecutor } from "./pollinations.js";
// OAuth import-token providers (ported from OmniRoute)
import { TraeExecutor } from "./trae.js";
import { TencentAIStudioWebExecutor } from "./tencent-aistudio-web.js";
import { TheOldLlmExecutor } from "./theoldllm.js";
import { FeloWebExecutor } from "./felo-web.js";
import { AihordeExecutor } from "./aihorde.js";
import { MimocodeExecutor } from "./mimocode.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  azure: new AzureExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  github: new GithubExecutor(),
  iflow: new IFlowExecutor(),
  qoder: new QoderExecutor(),
  kiro: new KiroExecutor(),
  kimchi: new KimchiExecutor(),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  vertex: new VertexExecutor("vertex"),
  "vertex-partner": new VertexExecutor("vertex-partner"),
  qwen: new QwenExecutor(),
  opencode: new OpenCodeExecutor(),
  "opencode-go": new OpenCodeGoExecutor(),
  "grok-web": new GrokWebExecutor(),
  "perplexity-web": new PerplexityWebExecutor(),
  "ollama-local": new OllamaLocalExecutor(),
  // commandcode now uses DefaultExecutor (OpenAI/Anthropic native endpoints)
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
  "xiaomi-mimo": new XiaomiMimoExecutor(),
  "mimo-free": new MimoFreeExecutor(),
  mmf: new MimoFreeExecutor(), // Alias for mimo-free
  "codebuddy-cn": new CodeBuddyExecutor("codebuddy-cn"),
  "codebuddy-intl": new CodeBuddyExecutor("codebuddy-intl"),
  workbuddy: new CodeBuddyExecutor("workbuddy"),
  devin: new DevinExecutor(),
  "zai-web": new ZaiWebExecutor(),
  // GLM effort tiers (glm-5.3-high/-low) resolved to base id + reasoning_effort.
  glm: new GlmExecutor("glm"),
  "glm-cn": new GlmExecutor("glm-cn"),
  // ZCode (zcode.z.ai OAuth) — Anthropic legs with auth-error fallback across
  // zcode-plan → bigmodel → api.z.ai; effort tiers inherited from GlmExecutor.
  zcode: new ZcodeExecutor("zcode"),
  // Web-cookie providers (ported from OmniRoute)
  "deepseek-web": new DeepSeekWebExecutor(),
  "qwen-web": new QwenWebExecutor(),
  "kimi-web": new KimiWebExecutor(),
  "kimi-desktop": new KimiWebExecutor(), // desktop token store → same www.kimi.com chat plane
  "blackbox-web": new BlackboxWebExecutor(),
  "t3-web": new T3ChatWebExecutor(),
  "duckduckgo-web": new DuckDuckGoWebExecutor(),
  "venice-web": new VeniceWebExecutor(),
  "doubao-web": new DoubaoWebExecutor(),
  "v0-vercel-web": new V0VercelWebExecutor(),
  "poe-web": new PoeWebExecutor(),
  "copilot-web": new CopilotWebExecutor(),
  "muse-spark-web": new MuseSparkWebExecutor(),
  "adapta-web": new AdaptaWebExecutor(),
  "veoaifree-web": new VeoAIFreeWebExecutor(),
  "claude-web": new ClaudeWebExecutor(),
  "chatgpt-web": new ChatGptWebExecutor(),
  "gemini-web": new GeminiWebExecutor(),
  "gemini-business": new GeminiBusinessExecutor(),
  gembiz: new GeminiBusinessExecutor(), // Alias for gemini-business
  "hailuo-web": new HailuoWebExecutor(),
  "inner-ai": new InnerAiExecutor(),
  "in-ai": new InnerAiExecutor(), // Alias for inner-ai
  "conol-web": new ConolWebExecutor(),
  cnl: new ConolWebExecutor(), // Alias for conol-web
  "notion-web": new NotionWebExecutor(),
  nw: new NotionWebExecutor(), // Alias for notion-web
  hyperagent: new HyperAgentExecutor(),
  ha: new HyperAgentExecutor(), // Alias for hyperagent
  // Web-cookie providers (ported from OmniRoute — batch 2)
  huggingchat: new HuggingChatExecutor(),
  "zenmux-free": new ZenmuxFreeExecutor(),
  "api-airforce": new ApiAirforceExecutor(),
  "freebuff-web": new FreeBuffWebExecutor(),
  "freebuff": new FreeBuffExecutor(),
  "inxorastudio-web": new InxorastudioWebExecutor(),
  "1min": new OneMinExecutor(),
  "1min-api": new OneMinApiExecutor(),
  "marathon": new MarathonExecutor(),
  "zed": new ZedExecutor(),
  "agnes-web": new AgnesWebExecutor(),
  "perplexity-agent": new PerplexityAgentExecutor(),
  "qwencloud": new QwenCloudExecutor(),
  lmarena: new LMArenaExecutor(),
  puter: new PuterExecutor(),
  pollinations: new PollinationsExecutor(),
  trae: new TraeExecutor(),
  "tencent-aistudio-web": new TencentAIStudioWebExecutor(),
  tasw: new TencentAIStudioWebExecutor(), // Alias for tencent-aistudio-web
  "theoldllm": new TheOldLlmExecutor(),
  tllm: new TheOldLlmExecutor(), // Alias for theoldllm
  "felo-web": new FeloWebExecutor(),
  felo: new FeloWebExecutor(), // Alias for felo-web
  aihorde: new AihordeExecutor("aihorde"),
  mimocode: new MimocodeExecutor("mimocode"),
  mcode: new MimocodeExecutor("mimocode"), // Alias for mimocode
};

const defaultCache = new Map();

export function getExecutor(provider) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  return !!executors[provider];
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { AzureExecutor } from "./azure.js";
export { GeminiCLIExecutor } from "./gemini-cli.js";
export { GithubExecutor } from "./github.js";
export { IFlowExecutor } from "./iflow.js";
export { QoderExecutor } from "./qoder.js";
export { KiroExecutor } from "./kiro.js";
export { KimchiExecutor } from "./kimchi.js";
export { CodexExecutor } from "./codex.js";
export { CursorExecutor } from "./cursor.js";
export { VertexExecutor } from "./vertex.js";
export { DefaultExecutor } from "./default.js";
export { QwenExecutor } from "./qwen.js";
export { OpenCodeExecutor } from "./opencode.js";
export { OpenCodeGoExecutor } from "./opencode-go.js";
export { GrokWebExecutor } from "./grok-web.js";
export { PerplexityWebExecutor } from "./perplexity-web.js";
export { OllamaLocalExecutor } from "./ollama-local.js";
// CommandCodeExecutor removed — provider now uses standard OpenAI/Anthropic endpoints (DefaultExecutor)
export { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
export { XiaomiMimoExecutor } from "./xiaomi-mimo.js";
export { MimoFreeExecutor } from "./mimo-free.js";
export { CodeBuddyExecutor } from "./codebuddy-cn.js";
export { DevinExecutor } from "./devin.js";
export { ZaiWebExecutor } from "./zai-web.js";
export { GlmExecutor } from "./glm.js";
export { ZcodeExecutor } from "./zcode.js";
// Web-cookie providers (ported from OmniRoute)
export { DeepSeekWebExecutor } from "./deepseek-web.js";
export { QwenWebExecutor } from "./qwen-web.js";
export { KimiWebExecutor } from "./kimi-web.js";
export { BlackboxWebExecutor } from "./blackbox-web.js";
export { T3ChatWebExecutor } from "./t3-web.js";
export { DuckDuckGoWebExecutor } from "./duckduckgo-web.js";
export { VeniceWebExecutor } from "./venice-web.js";
export { DoubaoWebExecutor } from "./doubao-web.js";
export { V0VercelWebExecutor } from "./v0-vercel-web.js";
export { PoeWebExecutor } from "./poe-web.js";
export { CopilotWebExecutor } from "./copilot-web.js";
export { MuseSparkWebExecutor } from "./muse-spark-web.js";
export { AdaptaWebExecutor } from "./adapta-web.js";
export { VeoAIFreeWebExecutor } from "./veoaifree-web.js";
export { ClaudeWebExecutor } from "./claude-web.js";
export { ChatGptWebExecutor } from "./chatgpt-web.js";
export { GeminiWebExecutor } from "./gemini-web.js";
export { GeminiBusinessExecutor } from "./gemini-business.js";
export { HailuoWebExecutor } from "./hailuo-web.js";
export { InnerAiExecutor } from "./inner-ai.js";
export { ConolWebExecutor } from "./conol-web.js";
export { NotionWebExecutor } from "./notion-web.js";
export { HyperAgentExecutor } from "./hyperagent.js";
// Web-cookie providers (ported from OmniRoute — batch 2)
export { HuggingChatExecutor } from "./huggingchat.js";
export { ZenmuxFreeExecutor } from "./zenmux-free.js";
export { ApiAirforceExecutor } from "./api-airforce.js";
export { FreeBuffWebExecutor } from "./freebuff-web.js";
export { FreeBuffExecutor } from "./freebuff.js";
export { InxorastudioWebExecutor } from "./inxorastudio-web.js";
export { OneMinExecutor } from "./onemin.js";
export { OneMinApiExecutor } from "./onemin-api.js";
export { MarathonExecutor } from "./marathon.js";
export { ZedExecutor } from "./zed.js";
export { AgnesWebExecutor } from "./agnes-web.js";
export { PerplexityAgentExecutor } from "./perplexity-agent.js";
export { QwenCloudExecutor } from "./qwencloud.js";
export { LMArenaExecutor } from "./lmarena.js";
export { PuterExecutor } from "./puter.js";
export { PollinationsExecutor } from "./pollinations.js";
// OAuth import-token providers (ported from OmniRoute)
export { TraeExecutor } from "./trae.js";
export { TencentAIStudioWebExecutor } from "./tencent-aistudio-web.js";
export { TheOldLlmExecutor } from "./theoldllm.js";
export { FeloWebExecutor } from "./felo-web.js";
export { AihordeExecutor } from "./aihorde.js";
export { MimocodeExecutor } from "./mimocode.js";
