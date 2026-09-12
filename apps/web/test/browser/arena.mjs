import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? '/tmp/4am-release-qa/node_modules/playwright/index.mjs'
);
const { users } = JSON.parse(await readFile('/tmp/4am-arena-fixture.json', 'utf8'));
const origin = process.env.ARENA_WEB_URL ?? 'http://127.0.0.1:5181';
const artifacts = '.impeccable/review/arena';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const contexts = [];
async function session(user, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  contexts.push(context);
  if (user)
    await context.addInitScript(
      (user) =>
        localStorage.setItem(
          '4am-auth',
          JSON.stringify({ state: { auth: { ...user, isPlatform: false } }, version: 0 }),
        ),
      user,
    );
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
async function request(path, user = users[0], body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    `${name}: horizontal overflow`,
  );
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
}
try {
  const host = await session(null);
  await host.goto(origin + '/tournaments');
  await host.waitForURL(/\/login\?next=/);
  await host.getByLabel('Username', { exact: true }).fill(users[0].username);
  await host.getByLabel('Password', { exact: true }).fill('local-arena-qa-only');
  await host.getByRole('button', { name: 'Log in', exact: true }).last().click();
  await host.waitForURL(origin + '/tournaments');
  await host.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await host.getByLabel('Tournament name', { exact: true }).fill('Agent Arena · local UAT');
  await host.getByLabel('Hands per entrant').selectOption('10');
  await host.getByLabel('Seats', { exact: true }).fill('2');
  await host
    .getByLabel('Prizes (optional)')
    .fill('Demo trophy — local QA only. No real prize or payment.');
  await host.getByRole('button', { name: 'Create and open enrollment' }).click();
  await host.waitForURL(/\/tournaments\/[a-f0-9]+$/);
  const id = host.url().split('/').at(-1);
  const entrants = await Promise.all([session(users[1]), session(users[2])]);
  for (let i = 0; i < entrants.length; i++) {
    const page = entrants[i];
    await page.goto(`${origin}/tournaments/${id}`);
    await page
      .getByLabel('Participant name')
      .fill(i ? 'Call Specialist · QA' : 'Pressure Policy · QA');
    await page.getByRole('button', { name: 'Enroll for free' }).click();
    await page.getByRole('button', { name: 'Withdraw', exact: true }).waitFor();
  }
  await entrants[0].getByRole('link', { name: 'Connect my agent' }).click();
  await entrants[0].getByRole('button', { name: 'Create access token' }).click();
  const downloaded = entrants[0].waitForEvent('download');
  await entrants[0].getByRole('button', { name: 'Download MCP configuration' }).click();
  const download = await downloaded;
  await download.saveAs('/tmp/4am-arena-agent-config.json');
  const config = JSON.parse(await readFile('/tmp/4am-arena-agent-config.json', 'utf8'));
  assert(config.mcpServers['4am-casino'].env.FOURAM_TOKEN.startsWith('4am_agent_'));
  assert.equal(config.mcpServers['4am-casino'].env.FOURAM_SIGNING_KEY, undefined);
  await shot(entrants[0], 'agents-desktop');
  await entrants[0].getByRole('button', { name: 'Revoke', exact: true }).first().click();
  await entrants[0].getByText('Agent access revoked.', { exact: true }).waitFor();
  const revoked = await fetch(origin + '/api/agent/identity', {
    headers: { authorization: `Bearer ${config.mcpServers['4am-casino'].env.FOURAM_TOKEN}` },
  });
  assert.equal(revoked.status, 401);
  await entrants[0].goto(`${origin}/tournaments/${id}`);
  await host.getByRole('button', { name: 'Start league', exact: true }).click();
  await host.getByRole('button', { name: 'Pause league', exact: true }).waitFor();
  await host.getByRole('button', { name: 'Pause league', exact: true }).click();
  await host.getByRole('button', { name: 'Resume league', exact: true }).waitFor();
  await host.getByRole('button', { name: 'Resume league', exact: true }).click();
  for (let h = 0; h < 10; h++) {
    const state = await request(`/api/tournaments/${id}`);
    const actor = users.findIndex((u) => u.userId === state.round.toActUserId);
    const page = entrants[actor - 1];
    const privateView = await request(`/api/tournaments/${id}`, users[actor]);
    assert.equal(privateView.round.myCards.length, 2);
    assert.equal(state.round.myCards.length, 0);
    const fold = page.getByRole('button', { name: 'Fold', exact: true });
    await fold.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Fold' && !b.disabled),
    );
    if (h === 0) {
      await shot(page, 'tournament-desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, 'tournament-mobile');
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await fold.click();
    await page.waitForFunction((previous) => {
      const bar = document.querySelector('progress');
      return bar && Number(bar.value) > previous;
    }, h);
  }
  await host.getByRole('heading', { name: 'League complete', exact: true }).waitFor();
  await host.getByRole('button', { name: 'Open rules & prizes', exact: true }).click();
  assert.equal(
    await host.getByRole('heading', { name: 'Bring your own agent', exact: true }).count(),
    0,
  );
  await host.getByLabel('Award note', { exact: true }).fill('QA trophy recorded; no payout.');
  await host.getByRole('button', { name: 'Record award note', exact: true }).click();
  await host.getByText('QA trophy recorded; no payout.', { exact: false }).first().waitFor();
  const done = await request(`/api/tournaments/${id}`);
  assert.equal(done.status, 'completed');
  assert.equal(done.completedHands, 10);
  assert.equal(
    done.entries.reduce((sum, e) => sum + e.net, 0),
    0,
  );
  await host.getByRole('button', { name: 'Standings', exact: true }).click();
  await shot(host, 'completed-desktop');
  await host.goto(origin + '/tournaments');
  await host.getByText('Agent Arena · local UAT', { exact: true }).waitFor();
  await shot(host, 'list-desktop');
  await host.setViewportSize({ width: 390, height: 844 });
  await shot(host, 'list-mobile');
  await host.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const dark = host.getByRole('button', { name: 'Use dark mode', exact: true });
  if (await dark.isVisible()) await dark.click();
  else {
    await host.getByRole('switch', { name: 'Dark mode', exact: true }).focus();
    await host.keyboard.press('Space');
  }
  await host.keyboard.press('Escape');
  await host.waitForFunction(() => document.documentElement.classList.contains('dark'));
  // Zeus finishes its 350 ms theme transition after updating the root class.
  await host.waitForTimeout(600);
  await shot(host, 'list-mobile-dark');
  assert.deepEqual(errors, []);
  await writeFile(
    '/tmp/4am-arena-browser-result.json',
    JSON.stringify(
      {
        passed: true,
        tournamentId: id,
        completedHands: 10,
        pageErrors: errors,
        checks: [
          'login return route',
          'create league',
          'two enrollments',
          'download scoped MCP configuration',
          'revoke token',
          'pause/resume',
          'ten hands using browser controls',
          'private cards isolated',
          'award note',
          'desktop/mobile layout',
          'dark appearance',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'Arena browser UAT passed: enrollment, scoped access, revoke, pause/resume, 10 hands, awards, responsive layouts.',
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
