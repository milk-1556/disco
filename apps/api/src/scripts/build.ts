/**
 * Terminal build runner — SAFE BY DEFAULT (Ledger pattern): it DRY-RUNS unless `--apply` is passed,
 * and `--apply` is refused unless a real target guild + bot token are present. So a script can never
 * silently mutate a real Discord server.
 *
 *   tsx src/scripts/build.ts <bundle.discobundle> [--server "New HQ"] [--apply --guild <id>]
 *
 * Without --apply: rebrand + simulate the whole build, print the report, write nothing.
 * With --apply + --guild + DISCORD_BOT_TOKEN: build into the real guild.
 */
import { readFileSync } from 'node:fs';
import { parseBundle, rebrand, rebuildGuild } from '@disco/core';
import type { RebrandConfig } from '@disco/schema';
import { DiscordGuildClient, DiskAssetStore, MockGuild } from '@disco/sdk';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const bundlePath = args.find((a) => !a.startsWith('--') && a !== argValue('--server') && a !== argValue('--guild'));
  const apply = args.includes('--apply');
  const guildId = argValue('--guild');
  const serverName = argValue('--server');
  const token = process.env.DISCORD_BOT_TOKEN ?? '';

  if (!bundlePath) {
    console.error('usage: build <bundle.discobundle> [--server "Name"] [--apply --guild <id>]');
    process.exit(1);
  }

  const { snapshot, config: bundleConfig } = parseBundle(JSON.parse(readFileSync(bundlePath, 'utf8')));
  const config: RebrandConfig =
    bundleConfig ?? { clientId: 'cli', findReplace: [], colorMap: [], linkMap: [], assets: {}, ...(serverName ? { serverName } : {}) };
  if (serverName) config.serverName = serverName;
  const { snapshot: rebranded } = rebrand(snapshot, config);

  // The gate: --apply must come with a real target + token, or we refuse and fall back to dry-run.
  let dryRun = !apply;
  if (apply && (!guildId || !token)) {
    console.error('⚠ --apply requires --guild <id> AND DISCORD_BOT_TOKEN. Refusing to apply; running a DRY-RUN instead.');
    dryRun = true;
  }

  const live = !dryRun && !!guildId && !!token;
  const store = new DiskAssetStore(process.env.STORAGE_DISK_PATH ?? './storage');
  const port = live ? new DiscordGuildClient({ token, guildId: guildId!, store }) : new MockGuild('900000000000000000', rebranded.guild.name);

  console.log(`\n${dryRun ? '◐ DRY-RUN' : '● APPLYING'} — building "${rebranded.guild.name}"${live ? ` into guild ${guildId}` : ' (mock)'}\n`);
  const { report } = await rebuildGuild(port, rebranded, { dryRun, targetGuildId: guildId ?? null, onLog: (m) => console.log('  ' + m) });

  console.log(`\n— Report —`);
  console.log(`  ${dryRun ? 'would create' : 'created'}: ${report.created.length}`);
  console.log(`  skipped:      ${report.skipped.length}`);
  console.log(`  manual steps: ${report.manualSteps.length}`);
  for (const w of report.warnings) console.log(`  ⚠ ${w}`);
  if (dryRun) console.log(`\nNothing was written. Re-run with --apply --guild <id> (and DISCORD_BOT_TOKEN) to build for real.`);
}

main().catch((err) => {
  console.error('build failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
