import { describe, expect, it } from 'vitest';
import { botSetupMarkdown, generateBotSetup, makeSampleSnapshot } from '../src/index.js';

describe('bot setup checklist generator (§6)', () => {
  it('builds an OAuth re-invite URL from the bot’s own app id + reconfigure steps', () => {
    const setup = generateBotSetup(makeSampleSnapshot().bots);
    const mee6 = setup.find((s) => s.name === 'MEE6');
    expect(mee6).toBeTruthy();
    expect(mee6!.vendor).toBe('MEE6');
    expect(mee6!.oauthUrl).toContain('client_id=159985870458322944');
    expect(mee6!.oauthUrl).toContain('scope=bot+applications.commands');
    expect(mee6!.oauthUrl).toContain('permissions=');
    // recognized feature notes become concrete steps
    expect(mee6!.reconfigure.some((r) => /reaction-role/i.test(r))).toBe(true);
    expect(mee6!.reconfigure.some((r) => /welcome/i.test(r))).toBe(true);
  });

  it('renders paste-ready markdown (and a graceful empty state)', () => {
    const md = botSetupMarkdown(generateBotSetup(makeSampleSnapshot().bots));
    expect(md).toContain('### MEE6');
    expect(md).toContain('**Re-invite:**');
    expect(botSetupMarkdown([])).toMatch(/No third-party bots/);
  });
});
