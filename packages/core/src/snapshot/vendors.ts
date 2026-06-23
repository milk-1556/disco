/** Best-effort recognition of well-known third-party bots by Discord application id or username. */
interface VendorInfo {
  vendor: string;
  inviteUrl: string;
  notes: string[];
}

const BY_APP_ID: Record<string, VendorInfo> = {
  '159985870458322944': { vendor: 'MEE6', inviteUrl: 'https://mee6.xyz/add', notes: ['welcome messages', 'reaction roles', 'leveling', 'moderation'] },
  '235148962103951360': { vendor: 'Carl-bot', inviteUrl: 'https://carl.gg/', notes: ['reaction roles', 'auto-responders', 'logging', 'tickets'] },
  '155149108183695360': { vendor: 'Dyno', inviteUrl: 'https://dyno.gg/', notes: ['moderation', 'auto-roles', 'custom commands'] },
  '282859044593598464': { vendor: 'ProBot', inviteUrl: 'https://probot.io/', notes: ['welcome images', 'reaction roles', 'moderation'] },
  '294882584201003009': { vendor: 'GiveawayBot', inviteUrl: 'https://giveawaybot.party/', notes: ['giveaways'] },
  '557628352828014614': { vendor: 'Ticket Tool', inviteUrl: 'https://tickettool.xyz/', notes: ['ticket panels'] },
  '536991182035746816': { vendor: 'Sapphire', inviteUrl: 'https://sapph.xyz/', notes: ['reaction roles', 'tickets', 'embeds'] },
};

const BY_NAME: Array<[RegExp, VendorInfo]> = [
  [/mee6/i, BY_APP_ID['159985870458322944']!],
  [/carl/i, BY_APP_ID['235148962103951360']!],
  [/dyno/i, BY_APP_ID['155149108183695360']!],
  [/probot/i, BY_APP_ID['282859044593598464']!],
  [/ticket/i, BY_APP_ID['557628352828014614']!],
  [/whop/i, { vendor: 'Whop', inviteUrl: 'https://whop.com/', notes: ['paid memberships', 'role gating', 'checkout'] }],
  [/sapphire/i, BY_APP_ID['536991182035746816']!],
];

export function recognizeVendor(applicationId: string | null, username: string): VendorInfo | null {
  if (applicationId && BY_APP_ID[applicationId]) return BY_APP_ID[applicationId];
  for (const [re, info] of BY_NAME) if (re.test(username)) return info;
  return null;
}
