import type { Client, Job } from '@disco/schema';
import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/repo.js';

/** Minimal valid Job-create shape (id/createdAt/updatedAt are assigned by the repo). */
const jobCreate = (clientId: string | null): Omit<Job, 'id' | 'createdAt' | 'updatedAt'> => ({
  kind: 'rebuild',
  status: 'completed',
  snapshotId: 'snap_sample',
  clientId,
  targetGuildId: null,
  dryRun: false,
  metrics: null,
  progress: 1,
  manifest: null,
  report: null,
  error: null,
});

const clientCreate: Omit<Client, 'id' | 'createdAt'> = {
  creatorName: 'Vega',
  handle: '@vega',
  brandColors: [],
  links: [],
  assets: {},
  termSwaps: [],
  notes: '',
  buildPrice: 4000,
  monthlyRetainer: 600,
  upsells: [],
};

describe('InMemoryRepo.deleteClient', () => {
  it('removes the client and unlinks its jobs while keeping the job records', async () => {
    const repo = new InMemoryRepo(false);
    const client = await repo.addClient(clientCreate);
    const other = await repo.addClient({ ...clientCreate, creatorName: 'Orion' });

    const linked = await repo.addJob(jobCreate(client.id));
    const otherLinked = await repo.addJob(jobCreate(other.id));

    await repo.deleteClient(client.id);

    // client gone
    expect(await repo.getClient(client.id)).toBeUndefined();
    expect(await repo.getClient(other.id)).toBeDefined();

    // the job record survives, but its clientId is nulled (unlinked)
    const jobs = await repo.listJobs();
    expect(jobs).toHaveLength(2);
    const kept = await repo.getJob(linked.id);
    expect(kept).toBeDefined();
    expect(kept!.clientId).toBeNull();

    // an unrelated client's job is untouched
    const untouched = await repo.getJob(otherLinked.id);
    expect(untouched!.clientId).toBe(other.id);
  });
});
