import { describe, expect, it } from 'vitest';
import { rebrand } from '../src/index.js';
import { makeSampleConfig, makeSampleSnapshot } from './fixtures.js';

describe('rebrand transform', () => {
  it('applies serverName override, find/replace, colorMap and linkMap', () => {
    const original = makeSampleSnapshot();
    const { snapshot, preview } = rebrand(original, makeSampleConfig());

    // server name override
    expect(snapshot.guild.name).toBe('Nova Slots HQ');

    // find/replace across roles, channels, welcome screen
    expect(snapshot.roles.find((r) => r.localRef === 'role_vip')?.name).toBe('Nova VIP');
    expect(snapshot.guild.welcomeScreen?.description).toBe('Welcome to Nova Slots HQ — grab your roles!');
    expect(snapshot.channels.find((c) => c.localRef === 'chan_rules')?.topic).toContain('Nova Slots rules');

    // colorMap: purple → rose on the VIP role and the rules embed
    expect(snapshot.roles.find((r) => r.localRef === 'role_vip')?.colors.primary).toBe(0xe11d48);
    const embed = snapshot.content[0]?.messages[0]?.embeds[0];
    expect(embed?.color).toBe(0xe11d48);

    // linkMap: old Whop link → new, everywhere it appears
    expect(snapshot.channels.find((c) => c.localRef === 'chan_rules')?.topic).toContain(
      'https://whop.com/nova-vip',
    );
    expect(embed?.description).toContain('https://whop.com/nova-vip');

    // preview records changes with rule attribution
    expect(preview.changes.some((c) => c.rule === 'serverName')).toBe(true);
    expect(preview.changes.some((c) => c.rule === 'colorMap')).toBe(true);
    expect(preview.changes.some((c) => c.rule === 'linkMap')).toBe(true);
    expect(preview.changes.some((c) => c.rule === 'findReplace')).toBe(true);
  });

  it('never mutates the original snapshot', () => {
    const original = makeSampleSnapshot();
    const frozen = structuredClone(original);
    rebrand(original, makeSampleConfig());
    expect(original).toEqual(frozen);
  });

  it('is deterministic and idempotent when re-run from the original (§4)', () => {
    const original = makeSampleSnapshot();
    const cfg = makeSampleConfig();
    const a = rebrand(original, cfg);
    const b = rebrand(original, cfg);
    expect(a.snapshot).toEqual(b.snapshot);
    expect(a.preview).toEqual(b.preview);
  });

  it('regenerates cleanly from the original when the config is edited (reversible)', () => {
    const original = makeSampleSnapshot();
    const first = rebrand(original, makeSampleConfig());
    expect(first.snapshot.guild.name).toBe('Nova Slots HQ');

    // Edit to a fully distinct second client and re-run FROM THE ORIGINAL. Because the transform
    // is pure over the original snapshot, NONE of the first client's branding ("Nova") leaks in.
    const edited = {
      clientId: 'client_zen',
      serverName: 'Zen Slots HQ',
      findReplace: [{ from: 'Acme', to: 'Zen', caseInsensitive: true, wholeWordSmart: true }],
      colorMap: [{ from: '#7C3AED', to: '#0000FF' }],
      linkMap: [{ from: 'https://whop.com/acme-vip', to: 'https://whop.com/zen-vip' }],
      assets: {},
    };
    const second = rebrand(original, edited);
    expect(second.snapshot.guild.name).toBe('Zen Slots HQ');
    // No residue from the first rebrand anywhere in the regenerated artifact.
    expect(JSON.stringify(second.snapshot)).not.toContain('Nova');
    // Content/structure is fully rebranded (brandTokens keep the original *detected* values by design).
    expect(second.snapshot.roles.find((r) => r.localRef === 'role_vip')?.name).toBe('Zen VIP');
    expect(second.snapshot.guild.welcomeScreen?.description).toBe('Welcome to Zen Slots HQ — grab your roles!');
    // first result is untouched by the second run
    expect(first.snapshot.guild.name).toBe('Nova Slots HQ');
  });

  it('reports unchanged brand tokens that no rule covered', () => {
    const original = makeSampleSnapshot();
    // config that swaps the name but NOT the color or link
    const cfg = { ...makeSampleConfig(), colorMap: [], linkMap: [] };
    const { preview } = rebrand(original, cfg);
    expect(preview.unchangedTokens).toContain('#7c3aed');
    expect(preview.unchangedTokens).toContain('https://whop.com/acme-vip');
    expect(preview.unchangedTokens).not.toContain('Acme'); // covered by findReplace
  });
});
