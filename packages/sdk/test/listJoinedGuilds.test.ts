import { REST } from 'discord.js';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listJoinedGuilds } from '../src/index.js';

/**
 * Coverage of the read-only `GET /users/@me/guilds` mapping without a real token, using the same
 * undici MockAgent pattern as discordClient.test.ts. Asserts the id/name/iconUrl shaping and the
 * permission → canManage logic (Administrator or Manage Guild ⇒ true; otherwise false).
 */
const ADMINISTRATOR = (1n << 3n).toString();
const MANAGE_GUILD = (1n << 5n).toString();

describe('listJoinedGuilds (mocked HTTP)', () => {
  let agent: MockAgent;
  let pool: ReturnType<MockAgent['get']>;
  let rest: REST;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    pool = agent.get('https://discord.com');
    rest = new REST({ version: '10' }).setToken('fake-token');
  });
  afterEach(async () => {
    await agent.close();
  });

  const replyGuilds = (data: unknown[]) => {
    pool
      .intercept({ path: (p) => /\/users\/@me\/guilds/.test(p), method: 'GET' })
      .reply(200, data, { headers: { 'content-type': 'application/json' } })
      .persist();
  };

  it('maps id/name/iconUrl and canManage across permission cases', async () => {
    replyGuilds([
      { id: '111', name: 'Admin Server', icon: 'abc', owner: true, permissions: ADMINISTRATOR },
      { id: '222', name: 'Manager Server', icon: null, owner: false, permissions: MANAGE_GUILD },
      { id: '333', name: 'No Perms Server', icon: 'def', owner: false, permissions: '0' },
    ]);

    const guilds = await listJoinedGuilds('fake-token', rest);
    expect(guilds).toHaveLength(3);

    const [admin, manager, none] = guilds;
    expect(admin).toEqual({
      id: '111',
      name: 'Admin Server',
      iconUrl: 'https://cdn.discordapp.com/icons/111/abc.png?size=64',
      owner: true,
      canManage: true,
    });
    expect(manager!.iconUrl).toBeNull();
    expect(manager!.canManage).toBe(true);
    expect(none!.canManage).toBe(false);
    expect(none!.iconUrl).toBe('https://cdn.discordapp.com/icons/333/def.png?size=64');
  });

  it('renders animated icons as gif and defaults missing permissions to not-manageable', async () => {
    replyGuilds([{ id: '444', name: 'Animated', icon: 'a_xyz' }]);
    const [g] = await listJoinedGuilds('fake-token', rest);
    expect(g!.iconUrl).toBe('https://cdn.discordapp.com/icons/444/a_xyz.gif?size=64');
    expect(g!.canManage).toBe(false);
    expect(g!.owner).toBe(false);
  });
});
