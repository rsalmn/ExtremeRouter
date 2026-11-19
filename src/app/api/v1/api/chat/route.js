import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import { CORS_ANY_ORIGIN } from "open-sse/config/runtimeConfig.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  await ensureInitialized();
  
  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body = await clonedReq.json();
    modelName = body.model || "llama3.2";
  } catch {}

  const response = await handleChat(request);
  // Pass upstream errors through untouched. Translating a non-OK response would
  // mask its real status/body as a 200 NDJSON stream ending in `done:true`.
  // Keep the endpoint's CORS header (the transform used to add it) plus any
  // upstream headers such as Retry-After.
  if (!response.ok) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", CORS_ANY_ORIGIN);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  return transformToOllama(response, modelName);
}

