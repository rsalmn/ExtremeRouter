// Agnes AI (API) — official API key access to Agnes models via apihub.agnes-ai.com.
//
// Sibling of the cookie/JWT provider ("agnes-web"). This variant uses the
// official developer API key issued from the Agnes dashboard. OpenAI-compatible
// — no custom executor needed (DefaultExecutor handles it).
//
// Auth: standard Authorization: Bearer <api_key>
//
// Supports both LLM chat (streaming + vision) and image generation.

export default {
  id: "agnes-api",
  priority: 59,
  alias: "agnes-api",
  aliases: ["agnesaapi"],
  uiAlias: "agnes-api",
  display: {
    name: "Agnes AI (API)",
    icon: "auto_awesome",
    color: "#6C5CE7",
    textIcon: "AG",
    website: "https://app.agnes-ai.com",
    notice: {
      signupUrl: "https://app.agnes-ai.com",
      apiKeyUrl: "https://app.agnes-ai.com",
      text: "Agnes AI official API. Create an API key in your Agnes dashboard, then paste it here. OpenAI-compatible — supports streaming, vision, and reasoning. Free tier available for Agnes 2.0/2.5 Flash.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    format: "openai",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    // Reasoning models (paid)
    { id: "agnes-2.5-pro-alpha", name: "Agnes 2.5 Pro Alpha", contextWindow: 1000000, maxOutput: 65536 },
    // Standard models (free tier)
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextWindow: 524288, maxOutput: 65536 },
    { id: "agnes-2.0", name: "Agnes 2.0", contextWindow: 524288, maxOutput: 65536 },
    // Text/image-to-video. Create: POST /v1/videos; poll: GET /agnesapi?video_id=.
    // v2.0 uses height/width/num_frames; 2.5 uses mode/seconds/size/aspect_ratio.
    // Adapter: handlers/videoProviders/agnes-api.js.
    {
      id: "agnes-video-v2.0",
      name: "Agnes Video 2.0",
      kind: "video",
      params: ["duration", "aspect_ratio", "resolution", "image", "mode", "width", "height", "num_frames", "frame_rate", "num_inference_steps", "seed", "negative_prompt"],
    },
    // 2.5: text | keyframe | reference; poll must include model_name.
    // Docs: https://www.agnes-ai.com/en/docs/agnes-video-25
    {
      id: "agnes-video-2.5",
      name: "Agnes Video 2.5",
      kind: "video",
      params: ["duration", "seconds", "aspect_ratio", "size", "resolution", "mode", "image", "images", "audios", "videos", "first_frame", "last_frame", "seed"],
    },
    // 2.5-flash: same API, size fixed to 720P, ≤5 images, ≤3 audios, no videos.
    // Docs: https://www.agnes-ai.com/en/docs/agnes-video-25-flash
    {
      id: "agnes-video-2.5-flash",
      name: "Agnes Video 2.5 Flash",
      kind: "video",
      params: ["duration", "seconds", "aspect_ratio", "size", "resolution", "mode", "image", "images", "audios", "first_frame", "last_frame", "seed"],
    },
  ],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://apihub.agnes-ai.com/v1/models",
    type: "openai",
  },
  // Image + video generation via separate endpoints.
  serviceKinds: ["llm", "image", "video"],
  imageConfig: {
    baseUrl: "https://apihub.agnes-ai.com/v1/images/generations",
    bodyFields: ["model", "prompt", "n", "size", "response_format"],
  },
  // Video: create POST /v1/videos → { video_id }; poll GET /agnesapi?video_id=[&model_name=].
  videoConfig: {
    baseUrl: "https://apihub.agnes-ai.com/v1/videos",
    pollUrl: "https://apihub.agnes-ai.com/agnesapi",
    bodyFields: ["model", "prompt", "image", "mode", "seconds", "size", "aspect_ratio", "height", "width", "num_frames", "frame_rate", "num_inference_steps", "seed", "negative_prompt", "first_frame", "last_frame", "images", "audios", "videos"],
  },
};
