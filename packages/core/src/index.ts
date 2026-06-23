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

// Queue contract (name + payload + redis connection) shared by api producer and worker consumer
export * from './queue.js';

// Transient-failure resilience (rate-limit + 5xx retry) for the Discord ports
export * from './resilience.js';

// Actionable Bot Setup Checklist (OAuth re-invite URLs + reconfigure markdown)
export * from './botSetup.js';

// Portable export/import bundle (§7) — snapshot + config + assets, checksummed
export * from './bundle.js';

// Pre-flight authority audit (does the bot have the perms Disco needs?)
export * from './authority.js';

// Per-build API-call metering for cost analytics
export * from './meter.js';
