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
import { CommandCodeExecutor } from "./commandcode.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { MimoFreeExecutor } from "./mimo-free.js";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { ChatGLMExecutor } from "./chatglm-cn.js";
import { DefaultExecutor } from "./default.js";
import { DevinExecutor } from "./devin.js";
// Web-cookie providers (ported from OmniRoute)
import { DeepSeekWebExecutor } from "./deepseek-web.js";
import { QwenWebExecutor } from "./qwen-web.js";
import { KimiWebExecutor } from "./kimi-web.js";
import { BlackboxWebExecutor } from "./blackbox-web.js";
import { ZenmuxFreeExecutor } from "./zenmux-free.js";
import { ApiAirforceExecutor } from "./api-airforce.js";
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
// Web-cookie providers (ported from OmniRoute — batch 2)
import { HuggingChatExecutor } from "./huggingchat.js";
import { LMArenaExecutor } from "./lmarena.js";
import { PuterExecutor } from "./puter.js";
import { PollinationsExecutor } from "./pollinations.js";
// OAuth import-token providers (ported from OmniRoute)
import { TraeExecutor } from "./trae.js";

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
  commandcode: new CommandCodeExecutor(),
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
  "mimo-free": new MimoFreeExecutor(),
  mmf: new MimoFreeExecutor(), // Alias for mimo-free
  "codebuddy-cn": new CodeBuddyExecutor(),
  devin: new DevinExecutor(),
  "chatglm-cn": new ChatGLMExecutor(),
  // Web-cookie providers (ported from OmniRoute)
  "deepseek-web": new DeepSeekWebExecutor(),
  "qwen-web": new QwenWebExecutor(),
  "kimi-web": new KimiWebExecutor(),
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
  // Web-cookie providers (ported from OmniRoute — batch 2)
  huggingchat: new HuggingChatExecutor(),
  "zenmux-free": new ZenmuxFreeExecutor(),
  "api-airforce": new ApiAirforceExecutor(),
  lmarena: new LMArenaExecutor(),
  puter: new PuterExecutor(),
  pollinations: new PollinationsExecutor(),
  trae: new TraeExecutor(),
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
export { CommandCodeExecutor } from "./commandcode.js";
export { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
export { MimoFreeExecutor } from "./mimo-free.js";
export { CodeBuddyExecutor } from "./codebuddy-cn.js";
export { DevinExecutor } from "./devin.js";
export { ChatGLMExecutor } from "./chatglm-cn.js";
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
// Web-cookie providers (ported from OmniRoute — batch 2)
export { HuggingChatExecutor } from "./huggingchat.js";
export { ZenmuxFreeExecutor } from "./zenmux-free.js";
export { ApiAirforceExecutor } from "./api-airforce.js";
export { LMArenaExecutor } from "./lmarena.js";
export { PuterExecutor } from "./puter.js";
export { PollinationsExecutor } from "./pollinations.js";
// OAuth import-token providers (ported from OmniRoute)
export { TraeExecutor } from "./trae.js";
