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
export * from './rebuild/execute.js';

// Discord port interfaces + capture engine (§3, §6)
export * from './ports.js';
export * from './snapshot/capture.js';
export * from './snapshot/refs.js';
export * from './snapshot/vendors.js';

// Shared canonical sample (template server) for tests, demos & MockGuild seeding
export * from './testing/sample.js';
