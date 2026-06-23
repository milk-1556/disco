import { REST } from 'discord.js';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiscordGuildClient, MemoryAssetStore } from '../src/index.js';

/**
 * Automated coverage of the LIVE discord.js v14 client without a real guild or token: undici's
 * MockAgent intercepts the actual HTTP so we assert the exact REST routes + snake_case bodies the
 * client issues, and the mapping of responses back to our Raw types. This exercises the live path
 * (REST queue + route building) before the first real-server run.
 */
const GUILD = '123456789012345678';

describe('DiscordGuildClient REST (mocked HTTP)', () => {
  let agent: MockAgent;
  let pool: ReturnType<MockAgent['get']>;
  let client: DiscordGuildClient;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    pool = agent.get('https://discord.com');
    requests.length = 0;
    const rest = new REST({ version: '10' }).setToken('fake-token');
    client = new DiscordGuildClient({ token: 'fake-token', guildId: GUILD, store: new MemoryAssetStore(), rest });
  });
  afterEach(async () => {
    await agent.close();
  });

  /** Intercept a route, record the request, and reply with `data`. */
  const route = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', match: RegExp, data: unknown) => {
    pool
      .intercept({ path: (p) => match.test(p), method })
      .reply((opts) => {
        requests.push({ method, path: String(opts.path), body: opts.body ? JSON.parse(String(opts.body)) : undefined });
        return { statusCode: 200, data, responseOptions: { headers: { 'content-type': 'application/json' } } };
      })
      .persist();
  };

  it('reads guild settings and maps snake_case → Raw', async () => {
    route('GET', /\/guilds\/123456789012345678$/, {
      id: GUILD,
      name: 'Acme Slots HQ',
      verification_level: 2,
      default_message_notifications: 0,
      explicit_content_filter: 1,
      afk_timeout: 300,
      system_channel_flags: 0,
      preferred_locale: 'en-US',
      premium_tier: 2,
      icon: 'abc',
    });
    const g = await client.getGuild();
    expect(g.name).toBe('Acme Slots HQ');
    expect(g.verificationLevel).toBe(2);
    expect(g.premiumTier).toBe(2);
    expect(g.iconUrl).toContain(`/icons/${GUILD}/abc.png`);
    expect(requests.some((r) => r.method === 'GET')).toBe(true);
  });

  it('creates a role with the right route + snake_case-safe body, returns the new id', async () => {
    route('POST', /\/guilds\/123456789012345678\/roles$/, { id: '999000111222333444', name: 'Nova VIP' });
    const id = await client.createRole({
      name: 'Nova VIP',
      colors: { primary: 0xe11d48, secondary: null, tertiary: null },
      hoist: true,
      mentionable: true,
      permissions: '0',
    });
    expect(id).toBe('999000111222333444');
    const req = requests.find((r) => r.method === 'POST');
    expect(req?.path).toMatch(/\/guilds\/123456789012345678\/roles/);
    expect((req?.body as { color: number }).color).toBe(0xe11d48);
    expect((req?.body as { permissions: string }).permissions).toBe('0');
  });

  it('creates a channel with snake_case forum/parent fields', async () => {
    route('POST', /\/guilds\/123456789012345678\/channels$/, { id: '888' });
    const id = await client.createChannel({ type: 0, name: 'rules', parentId: '777', position: 0, topic: 'be cool', rateLimitPerUser: 5 });
    expect(id).toBe('888');
    const body = requests.find((r) => r.path.endsWith('/channels'))?.body as Record<string, unknown>;
    expect(body.parent_id).toBe('777');
    expect(body.rate_limit_per_user).toBe(5);
    expect(body.type).toBe(0);
  });

  it('applies each permission overwrite via PUT', async () => {
    route('PUT', /\/channels\/888\/permissions\/.+$/, {});
    await client.setChannelOverwrites('888', [
      { id: '111', type: 0, allow: '1024', deny: '2048' },
      { id: '222', type: 1, allow: '8', deny: '0' },
    ]);
    const puts = requests.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect((puts[0]?.body as { allow: string }).allow).toBe('1024');
  });

  it('creates a webhook then executes it with author identity + embeds', async () => {
    route('POST', /\/channels\/888\/webhooks$/, { id: 'hook1', token: 'tok1' });
    route('POST', /\/webhooks\/hook1\/tok1/, {});
    const hook = await client.createWebhook('888', 'Disco');
    expect(hook).toEqual({ id: 'hook1', token: 'tok1' });
    await client.executeWebhook(hook, {
      id: '',
      author: { username: 'Nova', avatarUrl: null, bot: false },
      content: 'Welcome to Nova',
      embeds: [{ title: 'Rules', description: 'be cool', url: null, color: 0xe11d48, author: null, footer: null, image: null, thumbnail: null, timestamp: null, fields: [] }],
      pinned: false,
      componentSummary: [],
      createdAt: null,
    });
    const exec = requests.find((r) => r.path.includes('/webhooks/hook1/tok1'));
    expect((exec?.body as { username: string }).username).toBe('Nova');
    expect((exec?.body as { embeds: unknown[] }).embeds).toHaveLength(1);
  });
});
