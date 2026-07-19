// Client-safe re-export of pricing utilities.
//
// The canonical pricing module lives in `open-sse/providers/pricing.js` (engine
// directory). It happens to be pure (no server-only imports) so bundling it into
// a client component currently works, but the boundary is implicit — if anyone
// ever adds a server-only import to pricing.js, the client bundle breaks.
//
// This wrapper makes the client↔server boundary explicit. All client components
// that need pricing data import from HERE, never directly from open-sse/.

export { getPricingForModel, calculateCostFromTokens, formatCost } from "open-sse/providers/pricing.js";
