import type { Role } from './auth.js';
import type { Repo } from './repo.js';

export interface Actor {
  email: string;
  role: Role;
}

/**
 * Internal/system context — bypasses owner scoping. Used by the worker (buildProcessor), Stripe
 * fulfilment, seeds, and the public handover routes (which gate access by their own draft/password
 * rules, not by operator ownership). Never derive this from request input.
 */
export const SYSTEM_ACTOR: Actor = { email: '__system__', role: 'admin' };

/**
 * Wrap a Repo so every owner-sensitive read/list/mutation is scoped to `actor`: a regular operator
 * sees and can mutate ONLY records whose `ownerEmail` is theirs; an admin (the sole/default operator,
 * since roleFor makes OPERATOR_EMAIL admin) bypasses scoping and sees everything — so single-operator
 * behavior is unchanged and scoping engages only once a non-admin operator #2 exists.
 *
 * This is the SINGLE chokepoint for multi-operator access control. Authenticated routes obtain
 * `scopeRepo(repo, actorOf(req))` and use it for all owned resources (snapshots/clients/jobs/handovers/
 * build-events/views). A non-owned read returns undefined (→ the route 404s); a non-owned list is
 * filtered out; a non-owned mutate is a no-op returning undefined (→ the route 404s). Creates delegate
 * straight through — the route stamps `ownerEmail` from the authenticated operator.
 */
export function scopeRepo(base: Repo, actor: Actor): Repo {
  const isAdmin = actor.role === 'admin';
  // Require a NON-EMPTY match: '' -owned records are system/seed-only (admin-visible via bypass), and a
  // (hypothetical) actor with an empty email owns nothing — so neither side can collide on ''.
  const owns = (r: { ownerEmail: string } | null | undefined): boolean =>
    !!r && (isAdmin || (r.ownerEmail !== '' && r.ownerEmail === actor.email));
  const gate = <T extends { ownerEmail: string }>(r: T | undefined): T | undefined => (owns(r) ? r : undefined);

  return {
    // ── snapshots ──
    listSnapshots: async () => (await base.listSnapshots()).filter(owns),
    // The marketplace catalog is cross-operator BY DESIGN (shared==true items). NOT filtered by owner —
    // the route sanitizes each item (structure-only) before returning, so no private field leaks.
    listSharedSnapshots: () => base.listSharedSnapshots(),
    snapshotNames: async () => (await base.snapshotNames()).filter(owns),
    getSnapshot: async (id) => gate(await base.getSnapshot(id)),
    addSnapshot: (rec) => base.addSnapshot(rec), // route stamps ownerEmail
    updateSnapshot: async (id, patch) => (owns(await base.getSnapshot(id)) ? base.updateSnapshot(id, patch) : undefined),
    deleteSnapshot: async (id) => {
      if (owns(await base.getSnapshot(id))) await base.deleteSnapshot(id);
    },

    // ── clients ──
    listClients: async () => (await base.listClients()).filter(owns),
    getClient: async (id) => gate(await base.getClient(id)),
    addClient: (c) => base.addClient(c), // route stamps ownerEmail
    clientByStripeSession: (s) => base.clientByStripeSession(s), // system path (keyed by unique session)
    deleteClient: async (id) => {
      if (owns(await base.getClient(id))) await base.deleteClient(id);
    },

    // ── jobs ──
    listJobs: async () => (await base.listJobs()).filter(owns),
    getJob: async (id) => gate(await base.getJob(id)),
    addJob: (j) => base.addJob(j), // route stamps ownerEmail
    updateJob: async (id, patch) => (owns(await base.getJob(id)) ? base.updateJob(id, patch) : undefined),

    // ── handovers ──
    getHandover: async (id) => gate(await base.getHandover(id)),
    getHandoverByJob: async (jobId) => gate(await base.getHandoverByJob(jobId)),
    listHandovers: async () => (await base.listHandovers()).filter(owns),
    addHandover: (h) => base.addHandover(h), // route stamps ownerEmail
    updateHandover: async (id, patch) => (owns(await base.getHandover(id)) ? base.updateHandover(id, patch) : undefined),
    getHandoverPasswordHash: (id) => base.getHandoverPasswordHash(id), // public verification path

    // ── audit / build events / views ──
    addAudit: (e) => base.addAudit(e),
    listAudit: (limit, filter) => base.listAudit(limit, filter), // callers pass an operator/date filter
    addBuildEvent: (e) => base.addBuildEvent(e), // system (emitted by the worker)
    listBuildEvents: async (jobId, limit) => (await base.listBuildEvents(jobId, limit)).filter(owns),
    addWebhookEvent: (e) => base.addWebhookEvent(e), // system (Stripe/Discord handlers)
    listWebhookEvents: (limit, source) => base.listWebhookEvents(limit, source), // admin-gated at the route
    recordHandoverView: (hid, ref, kind) => base.recordHandoverView(hid, ref, kind), // public open
    recordHandoverSurvey: (hid, nps, comment) => base.recordHandoverSurvey(hid, nps, comment), // public survey submit
    listHandoverViews: async (handoverId) =>
      owns(await base.getHandover(handoverId)) ? base.listHandoverViews(handoverId) : [],

    // ── operator prefs (#4) — FORCE the actor's own key, ignoring any passed email, so an operator can
    // only ever read/write their own defaults regardless of what a route hands in.
    getOperatorPrefs: () => base.getOperatorPrefs(actor.email),
    upsertOperatorPrefs: (_email, patch) => base.upsertOperatorPrefs(actor.email, patch),
  };
}
