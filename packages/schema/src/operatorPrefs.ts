import { z } from 'zod';
import { OwnershipStep } from './handover.js';

/**
 * Per-operator defaults (#4). Each field has a REAL application point so it isn't a stored no-op:
 *  - defaultCanary / defaultDryRun  → seed POST /jobs when the request omits them.
 *  - defaultWelcomeMessage          → seed a new handover's welcome.
 *  - defaultOwnershipSteps (null = use the built-in defaultOwnershipSteps()) → seed a new handover's checklist.
 * Keyed by operatorEmail; an operator can only read/write their own (enforced in scopeRepo).
 */
export const OperatorPrefs = z.object({
  operatorEmail: z.string(),
  /** Default the "canary" (tiny verification slice) toggle for new builds. */
  defaultCanary: z.boolean().default(false),
  /** Default new builds to dry-run (plan only, no writes). */
  defaultDryRun: z.boolean().default(false),
  /** Pre-filled welcome message on the client handover page. */
  defaultWelcomeMessage: z.string().default(''),
  /** Operator's customized ownership-transfer checklist; null → the built-in default steps. */
  defaultOwnershipSteps: z.array(OwnershipStep).nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});
export type OperatorPrefs = z.infer<typeof OperatorPrefs>;

/** The defaults a brand-new operator gets before they've saved anything. */
export function emptyOperatorPrefs(operatorEmail: string): OperatorPrefs {
  return { operatorEmail, defaultCanary: false, defaultDryRun: false, defaultWelcomeMessage: '', defaultOwnershipSteps: null, updatedAt: null };
}

/** The patch shape accepted by PATCH /operator/prefs (operatorEmail + updatedAt are server-controlled). */
export const OperatorPrefsPatch = OperatorPrefs.partial().omit({ operatorEmail: true, updatedAt: true });
export type OperatorPrefsPatch = z.infer<typeof OperatorPrefsPatch>;
