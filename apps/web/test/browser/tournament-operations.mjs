import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? '/tmp/4am-release-qa/node_modules/playwright/index.mjs'
);
const { users } = JSON.parse(await readFile('/tmp/4am-arena-fixture.json', 'utf8'));
const origin = process.env.ARENA_WEB_URL ?? 'http://127.0.0.1:5181';
const artifacts = '.impeccable/review/tournament-operations';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [],
  checks = [],
  contexts = [];
async function page(user) {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  contexts.push(c);
  if (user)
    await c.addInitScript(
      (user) =>
        localStorage.setItem('4am-auth', JSON.stringify({ state: { auth: user }, version: 0 })),
      { ...user, isPlatform: user.userId === users[0].userId },
    );
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
}
async function api(path, user = users[0], body, method) {
  const r = await fetch(origin + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(user ? { authorization: `Bearer ${user.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const b = await r.json();
  assert(r.ok, `${path}: ${JSON.stringify(b)}`);
  return b;
}
async function shot(p, name) {
  await p.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: overflow`,
  );
  await p.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
}
const dateInput = (ms) => {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
try {
  const guest = await page();
  await guest.goto(origin + '/tournaments');
  await guest.getByRole('heading', { name: 'Tournaments', exact: true }).waitFor();
  assert.equal(
    await guest.getByRole('link', { name: 'Sign in to propose a tournament' }).count(),
    1,
  );
  checks.push('anonymous directory');
  const alice = await page(users[1]);
  const bob = await page(users[2]);
  const admin = await page(users[0]);
  await alice.goto(origin + '/tournaments');
  await alice.getByRole('button', { name: 'Propose a tournament', exact: true }).click();
  await alice.getByLabel('Tournament name', { exact: true }).fill('Open Championship · local UAT');
  await alice
    .getByLabel('Description', { exact: true })
    .fill('Local verification of approval, enrollment, prizes and public watching.');
  await alice.getByLabel('Hands per entrant', { exact: true }).fill('10');
  await alice.getByLabel('Seats', { exact: true }).fill('2');
  await alice.getByLabel('Small blind', { exact: true }).fill('100');
  await alice.getByLabel('Big blind', { exact: true }).fill('200');
  await alice.getByLabel('Entry fee · chips', { exact: true }).fill('100');
  await alice.getByLabel('Joining reward · chips', { exact: true }).fill('10');
  await alice.getByLabel('Organizer guarantee · chips', { exact: false }).fill('1000');
  await alice
    .getByLabel('Payout percentages · first place onward', { exact: false })
    .fill('60, 40');
  await alice.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await alice.waitForURL(/\/tournaments\/[a-f0-9]+$/);
  const id = alice.url().split('/').at(-1);
  assert.equal(
    (await api('/api/tournaments', null)).tournaments.some((t) => t.id === id),
    false,
  );
  checks.push('member proposal private');
  await admin.goto(origin + '/admin/tournaments');
  await admin.getByRole('button', { name: 'Approve revision 1' }).waitFor();
  await admin
    .getByLabel('Review note', { exact: true })
    .fill('Approved for local QA; no real money or prize.');
  await shot(admin, 'approval-desktop');
  await admin.getByRole('button', { name: 'Approve revision 1' }).click();
  await admin.getByRole('heading', { name: 'No proposals awaiting review.' }).waitFor();
  checks.push('platform approval');
  for (const p of [alice, bob]) {
    await p.goto(`${origin}/tournaments/${id}`);
    await p.getByLabel('Participant name', { exact: true }).waitFor();
    assert(await p.getByRole('button', { name: /Accept & enroll/ }).isDisabled());
    await p.getByLabel(/I accept revision 1/).check();
    await p.getByLabel('Who will play?').selectOption('human');
    await p.getByRole('button', { name: 'Accept & enroll · 100 chips', exact: true }).click();
    await p.getByRole('button', { name: 'Withdraw', exact: true }).waitFor();
  }
  assert.equal(
    (await api(`/tournaments/${id}`.replace('/tournaments', '/api/tournaments'))).termsLocked,
    true,
  );
  checks.push('enrollment consent and locked terms');
  await alice.getByRole('link', { name: 'Connect my agent', exact: true }).click();
  await alice.getByRole('button', { name: 'Create access token', exact: true }).click();
  const downloaded = alice.waitForEvent('download');
  await alice.getByRole('button', { name: 'Download MCP configuration', exact: true }).click();
  const download = await downloaded;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const config = JSON.parse(Buffer.concat(chunks).toString());
  const agentEnv = config.mcpServers['4am-casino'].env;
  assert(agentEnv.FOURAM_TOKEN.startsWith('4am_agent_'));
  assert.equal(agentEnv.FOURAM_SIGNING_KEY, undefined);
  await alice.getByRole('button', { name: 'Revoke', exact: true }).first().click();
  await alice.getByText('Agent access revoked.', { exact: true }).waitFor();
  assert.equal(
    (
      await fetch(origin + '/api/agent/identity', {
        headers: { authorization: `Bearer ${agentEnv.FOURAM_TOKEN}` },
      })
    ).status,
    401,
  );
  checks.push('scoped MCP configuration and token revocation');
  await alice.goto(`${origin}/tournaments/${id}`);
  await admin.getByRole('button', { name: 'Sponsors', exact: true }).click();
  await admin.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await admin.getByLabel('Sponsor name', { exact: true }).fill('QA Partners');
  await admin.getByLabel('Headline', { exact: true }).fill('Supporting the next poker agents');
  await admin
    .getByLabel('Description', { exact: true })
    .fill('A local-only sponsorship used to verify placement and accounting.');
  await admin.getByLabel('Destination URL · HTTPS', { exact: true }).fill('https://example.com');
  await admin.getByLabel('Placement').selectOption('watch');
  await admin.getByLabel('Tournament scope').selectOption(id);
  await admin.getByLabel('Publish from · local time').fill(dateInput(Date.now() - 3600000));
  await admin.getByLabel('Publish until · local time').fill(dateInput(Date.now() + 86400000));
  await admin.getByLabel('Booked amount · chips').fill('500');
  await admin
    .getByLabel('Internal note', { exact: true })
    .fill('Private accounting note, never public');
  await admin.getByRole('button', { name: 'Create campaign', exact: true }).last().click();
  await admin.getByRole('button', { name: 'Record receipt', exact: true }).waitFor();
  await admin.getByRole('button', { name: 'Record receipt', exact: true }).click();
  await admin.getByLabel('Received amount · chips').fill('500');
  await admin.getByLabel('Prize contribution · chips').fill('250');
  await admin.getByLabel('Tournament receiving contribution').selectOption(id);
  await admin.getByLabel('Receipt reference or note').fill('Local QA receipt');
  await admin.route(
    '**/api/admin/sponsors/*/receipts',
    async (route) => {
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated lost response' }),
      });
    },
    { times: 1 },
  );
  await admin.getByRole('button', { name: 'Record received chips', exact: true }).click();
  await admin.getByRole('button', { name: 'Retry same receipt record', exact: true }).click();
  await admin.getByRole('heading', { name: /Record receipt ·/ }).waitFor({ state: 'hidden' });
  assert.equal((await api('/api/admin/sponsors')).totals.received, 500);
  checks.push('sponsor creation and idempotent receipt retry');
  await shot(admin, 'sponsors-desktop');
  const watch = await page();
  await watch.goto(`${origin}/tournaments/${id}/watch`);
  await watch.getByText('Sponsored · QA Partners', { exact: true }).waitFor();
  assert.equal(
    await watch.getByText('Private accounting note, never public', { exact: true }).count(),
    0,
  );
  assert.deepEqual((await api(`/api/tournaments/${id}/watch`, users[1])).round?.myCards ?? [], []);
  checks.push('anonymous sponsor projection');
  await alice.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await alice.getByRole('button', { name: 'Pause tournament', exact: true }).click();
  await alice.getByRole('button', { name: 'Resume tournament', exact: true }).click();
  checks.push('start pause resume');
  for (let h = 0; h < 10; h++) {
    const state = await api(`/api/tournaments/${id}`);
    const actor = users.findIndex((u) => u.userId === state.round.toActUserId);
    const p = actor === 1 ? alice : bob;
    const privateState = await api(`/api/tournaments/${id}`, users[actor]);
    assert.equal(privateState.round.myCards.length, 2);
    await p.bringToFront();
    await p.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Fold' && !b.disabled),
    );
    await p.getByRole('button', { name: 'Fold', exact: true }).click();
    await p.waitForFunction((h) => Number(document.querySelector('progress')?.value) > h, h);
  }
  const done = await api(`/api/tournaments/${id}`);
  assert.equal(done.status, 'completed');
  assert.equal(done.completedHands, 10);
  assert.equal(done.finance.pool, 0);
  assert.equal(done.finance.banker, 10);
  assert.equal(done.finance.house, 10);
  assert.equal(done.finance.prizes, 1440);
  checks.push('ten browser hands and complete conserved payout');
  await watch.bringToFront();
  await watch.getByText('Tournament complete', { exact: true }).waitFor();
  await watch.getByRole('combobox', { name: /^Hand/ }).selectOption('1');
  await watch.getByText('Hand 1 · Final reveal', { exact: true }).waitFor();
  await watch.getByRole('button', { name: 'Next', exact: true }).click();
  assert.equal((await api(`/api/tournaments/${id}/hands/1`, null)).result.revealed.length, 2);
  checks.push('finished hand replay and all-card reveal');
  await shot(watch, 'watch-desktop');
  await watch.setViewportSize({ width: 390, height: 844 });
  await shot(watch, 'watch-mobile');
  await admin.goto(origin + '/admin/tournaments');
  await admin.getByRole('button', { name: 'Earnings', exact: true }).click();
  await admin.getByLabel('Search earnings').fill(users[2].username);
  await admin.getByRole('button', { name: 'Record settlement', exact: true }).click();
  await admin.getByLabel('Settlement note', { exact: true }).fill('Local QA paid record');
  await admin.route(
    '**/api/admin/tournaments/*/settlements',
    async (route) => {
      await route.fetch();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated lost response' }),
      });
    },
    { times: 1 },
  );
  await admin.getByRole('button', { name: 'Record manual settlement', exact: true }).click();
  await admin.getByRole('button', { name: 'Retry same settlement record', exact: true }).click();
  await admin.getByRole('heading', { name: /Record settlement ·/ }).waitFor({ state: 'hidden' });
  const earnings = (await api('/api/me/tournament-earnings', users[2])).earnings;
  assert.equal(earnings[0].outstanding, 0);
  assert.equal(earnings[0].recordedPaid, 630);
  checks.push('idempotent manual settlement and personal earnings');
  await admin.getByLabel('Search earnings').fill('');
  await shot(admin, 'earnings-desktop');
  await admin.setViewportSize({ width: 390, height: 844 });
  await shot(admin, 'earnings-mobile');
  await bob.goto(origin + '/settle');
  await bob.getByRole('heading', { name: 'Tournament earnings', exact: true }).waitFor();
  assert.equal(
    await bob.getByRole('link', { name: 'Open Championship · local UAT', exact: true }).count(),
    1,
  );
  await alice.goto(`${origin}/tournaments/${id}`);
  await alice.getByRole('button', { name: 'Winnings', exact: true }).click();
  await shot(alice, 'winnings-desktop');
  await guest.goto(origin + '/tournaments');
  await guest.getByRole('button', { name: 'Past', exact: true }).click();
  await guest.getByText('Open Championship · local UAT', { exact: true }).waitFor();
  await shot(guest, 'directory-desktop');
  await watch.setViewportSize({ width: 390, height: 844 });
  const darkButton = watch.getByRole('button', { name: 'Use dark mode', exact: true });
  if (await darkButton.isVisible()) await darkButton.click();
  else {
    await watch.getByRole('switch', { name: 'Dark mode', exact: true }).focus();
    await watch.keyboard.press('Space');
  }
  await watch.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await watch.waitForTimeout(600);
  await shot(watch, 'watch-mobile-dark');
  assert.deepEqual(errors, []);
  checks.push('desktop mobile dark and zero page errors');
  await writeFile(
    '/tmp/4am-tournament-operations-browser.json',
    JSON.stringify({ passed: true, tournamentId: id, checks, pageErrors: errors }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, tournamentId: id, checks, pageErrors: errors }, null, 2),
  );
} finally {
  await browser.close();
}
