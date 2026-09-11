// Video provider adapter registry — the video-analog of imageProviders/index.js.
// `getVideoAdapter(provider)` resolves a provider id to its video adapter, or
// null when the provider does not implement text-to-video generation.
import runwayml from "./runwayml.js";
import bynara from "./bynara.js";
import xai from "./xai.js";
import openrouter from "./openrouter.js";
import vertex from "./vertex.js";
import agnesApi from "./agnes-api.js";

const ADAPTERS = {
  runwayml,
  bynara,
  xai,
  openrouter,
  vertex,
  "agnes-api": agnesApi,
};

export function getVideoAdapter(provider) {
  return ADAPTERS[provider] || null;
}
