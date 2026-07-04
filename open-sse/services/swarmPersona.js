/**
 * Persona-Bleed Protection for Hierarchical Swarm.
 *
 * IDE coding assistants (Cursor, Cline, Claude Code, Codex...) inject strong
 * "you are a coding assistant" system prompts. When the swarm's coordinator
 * roles (Manager/Staff) receive those prompts, the IDE persona can override
 * swarm orchestration instructions — producing malformed JSON strategies,
 * refusal to delegate, or direct coding answers instead of decomposition.
 *
 * Strategy:
 *  - Coordinators (Manager/Staff/Audit): IDE system prompts are STRIPPED,
 *    then the role's directive is injected clean. This guarantees the
 *    coordinator obeys swarm instructions, not the IDE persona.
 *  - Workers: receive the FULL unsanitized context (original system prompt +
 *    tool history) so they can write code that fits the user's actual
 *    environment. The specialist role is added as a user-turn directive to
 *    avoid clobbering the existing system prompt.
 */

// Heuristics for detecting IDE-injected system/developer messages.
// Matches common phrasings from Cursor, Cline, Claude Code, Copilot, Windsurf, etc.
const IDE_PROMPT_PATTERNS = [
  /you are (an? )?(expert|senior|principal|staff)?\s*(coding|programming|software|ai)\s*(assistant|agent|engineer|companion|specialist)/i,
  /you are (claude|cursor|cline|copilot|windsurf|aider|roo|cody|continue)/i,
  /your (primary )?(task|role|job|goal) is to (help|assist|act as)/i,
  /follow the user[''']?s instructions/i,
  /you are operating as (a |an )?(pair|interactive|autonomous)/i,
  /write (clean|idiomatic|production)[- ]ready code/i,
  /you have access to (a set of |various )?tools/i,
  /<environment|<context|<system_prompt>/i,
];

/**
 * Detect whether a single message looks like an IDE-injected system prompt.
 */
function looksLikeIdePrompt(content) {
  if (!content || typeof content !== "string") return false;
  // Short system messages (e.g. "You are a helpful assistant.") are generic — keep them.
  if (content.length < 80) return false;
  return IDE_PROMPT_PATTERNS.some((re) => re.test(content));
}

function messageContentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("\n");
  }
  return "";
}

/**
 * Strip IDE-injected system/developer messages from a request body.
 * Returns a NEW body — original is untouched. Generic short system prompts
 * (e.g. "You are helpful") are preserved so the model still has a baseline persona.
 *
 * Handles OpenAI messages[]/input[], Claude system (string or content blocks),
 * and Gemini system_instruction.
 */
export function stripIdeSystemPrompt(body) {
  if (!body) return body;
  const next = { ...body };

  // OpenAI chat / Responses: messages[] or input[]
  for (const key of ["messages", "input"]) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].filter((msg) => {
        if (msg?.role !== "system" && msg?.role !== "developer") return true;
        const text = messageContentToString(msg.content);
        return !looksLikeIdePrompt(text);
      });
    }
  }

  // Claude: body.system can be a string OR [{type:"text", text}]
  if (typeof next.system === "string" && looksLikeIdePrompt(next.system)) {
    delete next.system;
  } else if (Array.isArray(next.system)) {
    const filtered = next.system.filter(
      (block) => !(block?.type === "text" && looksLikeIdePrompt(block.text))
    );
    next.system = filtered.length > 0 ? filtered : undefined;
    if (next.system === undefined) delete next.system;
  }

  // Gemini: system_instruction / systemInstruction { parts: [{text}] }
  for (const key of ["system_instruction", "systemInstruction"]) {
    const si = next[key];
    if (!si) continue;
    const text = Array.isArray(si.parts)
      ? si.parts.map((p) => p?.text || "").join("\n")
      : "";
    if (looksLikeIdePrompt(text)) delete next[key];
  }

  return next;
}

/**
 * Worker specialist prompt templates.
 * The Manager assigns each subtask a `role`; this maps roles to specialist
 * directives injected as a user-turn (not system) so the worker keeps its
 * original coding context but focuses on the assigned specialty.
 */
export const WORKER_SPECIALIST_HINTS = {
  // Fallback when the Manager didn't specify a recognized role.
  default:
    "You are a specialist worker in a swarm. Focus exclusively on your assigned subtask. Produce complete, production-ready output. Do not attempt other subtasks.",
  architecture:
    "You are a software architect. Design the structure, interfaces, and module boundaries for your assigned component. Prioritize clean separation of concerns.",
  "game-logic": "You are a game-logic specialist. Implement mechanics, state machines, and rules with correctness and balance in mind.",
  "data-layer":
    "You are a data/persistence specialist. Implement storage, schemas, serialization, and access patterns with integrity and performance in mind.",
  ui: "You are a UI/UX specialist. Build accessible, responsive interfaces with clean component structure.",
  testing: "You are a testing specialist. Write thorough tests covering happy paths, edge cases, and failure modes.",
  security:
    "You are a security specialist. Harden inputs, prevent injection/XSS, and enforce least-privilege.",
  devops: "You are a DevOps specialist. Handle deployment, configuration, and operational concerns.",
};

/**
 * Build a worker directive: specialist hint + the specific subtask instruction.
 * Returned text is meant for `appendUserTurn(workerBody, directive)`.
 */
export function buildWorkerDirective(subtask) {
  const hint = WORKER_SPECIALIST_HINTS[subtask?.role] || WORKER_SPECIALIST_HINTS.default;
  const instruction = subtask?.instruction || subtask?.title || "Complete your assigned subtask.";
  return [
    "=== SWARM WORKER DIRECTIVE ===",
    hint,
    "",
    `Subtask: ${subtask?.title || "Untitled"}`,
    "",
    instruction,
    "",
    "Output ONLY your work for this subtask. Do not reference other workers or the orchestrator.",
    "=== END DIRECTIVE ===",
  ].join("\n");
}
