// xAI (Grok) usage handler for Quota Tracker.
//
// STATUS: DISABLED — xAI removed the public billing/subscription endpoints from
// the inference API (api.x.ai). Both endpoints below now return HTTP 404:
//   - GET /v1/billing?format=credits  -> 404 (removed)
//   - GET /v1/user?include=subscription -> 404 (removed)
//
// xAI migrated billing & usage tracking to a SEPARATE Management API on a
// different host (https://management-api.x.ai) that requires a dedicated
// Management API key — distinct from both the chat API key and the OAuth
// access token. The Management API is only available to account owners via
// console.x.ai → Settings → Management Keys.
//
// As of 2026-07, there is no public REST endpoint reachable with the
// credentials stored in an ExtremeRouter connection. Until xAI documents a
// public billing endpoint OR ExtremeRouter adds a Management Key field (same
// two-key design as TokenRouter), this handler returns an informational
// message so the Quota Tracker card explains WHY it is empty instead of
// appearing blank.
//
// Reference: github.com/decolua/9router PR #2672 (original implementation
// against the now-defunct endpoints).

// Forward-compat hook: if a Management API key is ever wired up
// (providerSpecificData.mgmtKey, mirroring TokenRouter), this handler can be
// re-enabled against https://management-api.x.ai/billing without touching the
// registration in services/usage.js.
export async function getXaiUsage(credentials, _proxyOptions = null) {
  const hasMgmtKey = Boolean(
    credentials?.providerSpecificData?.mgmtKey ||
      credentials?.providerDataWithProjectId?.mgmtKey
  );

  if (hasMgmtKey) {
    // If a Management Key is present we still cannot reach a documented billing
    // endpoint today, but we acknowledge the credential so the message can
    // guide the user.
    return {
      quotas: {},
      plan: null,
      credits: null,
      message:
        "xAI Management API key detected, but the billing endpoint is not yet implemented. " +
        "Usage tracking for xAI is pending upstream documentation.",
    };
  }

  return {
    quotas: {},
    plan: null,
    credits: null,
    message:
      "xAI removed the public billing API. Usage tracking is only available in the " +
      "xAI Console at console.x.ai → Billing.",
  };
}
