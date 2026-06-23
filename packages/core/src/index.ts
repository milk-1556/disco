// Rebrand engine (§4)
export * from './rebrand/color.js';
export * from './rebrand/findReplace.js';
export * from './rebrand/transform.js';

// Brand-token extraction (§4)
export * from './extract/brandTokens.js';

// Channel content classification (§5)
export * from './classify/channelPolicy.js';

// Rebuild planning, idempotency & dry-run (§6)
export * from './rebuild/manifest.js';
export * from './rebuild/plan.js';
