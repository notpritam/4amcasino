/** Browser regression against a running Vite server. No real account or room is used.
 * PLAYWRIGHT_MODULE may point to an existing Playwright installation.
 * BROWSER_EXECUTABLE may select a cached Chromium executable.
 * BASE_URL defaults to http://localhost:5174; MODES defaults to 2d,3d.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://localhost:5174';
const out = process.env.UAT_OUTPUT || '/tmp/4am-post-hand-deal';
await mkdir(out, { recursive: true });
const sharedPath = fileURLToPath(
  new URL('../../../../packages/shared/src/index.ts', import.meta.url),
);
const names = ['Alex', 'Meera', 'Zoya', 'Ishaan', 'River', 'Jules', 'Mira', 'Sol', 'Sam'];
const room = {
  t: 'room_state',
  room: {
    id: 'post-hand-qa',
    name: 'Post-hand controls',
    joinCode: 'QATEST',
    hostId: 2,
    bankerId: 2,
    sb: 10,
    bb: 20,
    auditMode: 'strict',
    actionTimeoutMs: 45000,
    actionSecs: 45,
    coBankerId: null,
    minSettleHands: 0,
    sevenDeuceBonus: 0,
    voided: false,
    meetLink: null,
    autoApproveBuys: false,
    tvReplays: false,
    commissionBps: Number(process.env.COMMISSION_BPS || 10),
  },
  players: names.map((name, i) => ({
    userId: i + 2,
    username: name.toLowerCase(),
    displayName: name,
    seat: (i + 4) % 9,
    stack: 2000,
    connected: true,
    sittingOut: false,
    totalBought: 2000,
    hasAvatar: false,
    avatarVersion: 0,
    pendingBuy: 0,
    avatar3d: null,
  })),
  handActive: false,
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE,
  args: process.env.NO_WEBGL ? ['--disable-webgl'] : ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  for (const mode of (process.env.MODES || '2d,3d').split(',')) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript(() => {
      localStorage.setItem(
        '4am-auth',
        JSON.stringify({
          state: {
            auth: {
              token: 'local-ui-fixture',
              userId: 2,
              username: 'alex',
              identity: null,
            },
          },
          version: 0,
        }),
      );
      localStorage.setItem('4am-big-cards', 'on');
      localStorage.setItem('4am-cards-pos', JSON.stringify({ x: 0, y: 0 }));
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (route) =>
      route.fulfill({
        json: {
          ok: true,
          rooms: [],
          requests: [],
          rows: [],
          friends: [],
          incoming: [],
          outgoing: [],
          hands: [],
          isPlatform: false,
          cardBack: 'indigo',
          fourColor: false,
        },
      }),
    );
    const sent = [];
    await page.routeWebSocket('**/*', (ws) =>
      ws.onMessage((data) => {
        const msg = JSON.parse(String(data));
        sent.push(msg.t);
        if (msg.t === 'join_room') ws.send(JSON.stringify(room));
      }),
    );
    await page.goto(`${base}/room/${room.room.id}${mode === '3d' ? '/3d' : ''}`);
    await page.getByRole('button', { name: 'Deal hand', exact: true }).first().waitFor();
    await page.evaluate(async (path) => {
      const { useStore, emptyHand } = await import('/src/shared/store.ts');
      const { evaluate7 } = await import('/@fs' + path);
      window.qaStore = useStore;
      window.qaEmpty = emptyHand;
      window.qaEvaluate7 = evaluate7;
    }, sharedPath);
    const frames = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      });
    const fixture = async (kind) => {
      await page.evaluate((kind) => {
        const s = qaStore.getState();
        const baseHand = {
          ...qaEmpty,
          handId: `fixture-${kind}`,
          seats: s.room.players,
          myCards: [0, 1],
        };
        if (kind === 'abort') {
          qaStore.setState({
            hand: {
              ...baseHand,
              abort: {
                t: 'hand_abort',
                handId: baseHand.handId,
                blamedSeat: null,
                reason: 'Connection lost. All bets were returned. '.repeat(60),
              },
            },
          });
          return;
        }
        const board = [20, 25, 29, 33, 41];
        const reveals = s.room.players.map((p, i) => ({
          seat: p.seat,
          cards: [i * 2, i * 2 + 1],
          score: qaEvaluate7([...board, i * 2, i * 2 + 1]),
        }));
        const winner = reveals.reduce((a, b) => (a.score > b.score ? a : b)).seat;
        qaStore.setState({
          hand: {
            ...baseHand,
            board,
            showdown:
              kind === 'fold'
                ? null
                : {
                    t: 'showdown',
                    handId: baseHand.handId,
                    reveals,
                    awards: [{ seat: winner, amount: 990 }],
                  },
            result: {
              t: 'hand_end',
              handId: baseHand.handId,
              head: 'qa',
              commission: 2,
              stacks: s.room.players.map((p) => ({ seat: p.seat, stack: 2000 })),
              deltas: s.room.players.map((p) => ({
                seat: p.seat,
                delta: p.seat === winner ? 880 : -110,
              })),
            },
          },
        });
      }, kind);
      await frames();
    };
    const reachable = async (locator) =>
      locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        );
      });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      for (const kind of ['showdown', 'fold', 'abort']) {
        await page.evaluate(() => {
          scrollTo(0, 0);
          qaStore.setState({ hand: qaEmpty });
        });
        await frames();
        const canvas =
          mode === '3d' && !process.env.NO_WEBGL
            ? await page.locator('.lounge-canvas canvas').boundingBox()
            : null;
        await fixture(kind);
        if (kind !== 'abort') {
          const rate = `${room.room.commissionBps / 100}%`;
          const label = page.getByText(new RegExp(`${rate} (table )?commission`));
          const visibleLabels = await Promise.all((await label.all()).map((item) => item.isVisible()));
          assert.equal(visibleLabels.filter(Boolean).length, 1, `${mode}: result shows the room's ${rate} rate`);
        }
        const visible = async (locator) => {
          const list = [];
          for (const item of await locator.all()) if (await item.isVisible()) list.push(item);
          return list;
        };
        const buttons = await visible(
          page.getByRole('button', { name: /^(Deal hand|Start hand)$/ }),
        );
        assert.equal(
          buttons.length,
          1,
          `${mode}/${viewport.width}/${kind}: one visible Deal control while result is open`,
        );
        assert.ok(
          await reachable(buttons[0]),
          `${mode}/${viewport.width}/${kind}: result must not cover Deal`,
        );
        if (mode === '3d') {
          const bounds = await page.locator('.floating-card-bounds').boundingBox();
          const cards = await page.locator('.floating-cards').boundingBox();
          assert.ok(cards.x >= bounds.x - 1 && cards.y >= bounds.y - 1);
          assert.ok(cards.x + cards.width <= bounds.x + bounds.width + 1);
          assert.ok(cards.y + cards.height <= bounds.y + bounds.height + 1);
        }
        const dismiss = await visible(
          page.getByRole('button', { name: 'Dismiss result', exact: true }),
        );
        assert.equal(dismiss.length, 1, 'Only one visible recap');
        const before = sent.filter((t) => t === 'start_hand').length;
        await buttons[0].click();
        assert.equal(
          sent.filter((t) => t === 'start_hand').length,
          before + 1,
          'Deal sends start_hand',
        );
        if (mode === '3d' && !process.env.NO_WEBGL)
          assert.deepEqual(await page.locator('.lounge-canvas canvas').boundingBox(), canvas);
        if (kind === 'showdown')
          await page.screenshot({ path: `${out}/${mode}-${viewport.width}.png` });
        await dismiss[0].click();
        assert.equal(
          (await visible(page.getByRole('button', { name: 'Dismiss result', exact: true }))).length,
          0,
        );
        if (mode === '3d' && kind === 'showdown') {
          const cards = page.locator('.floating-cards');
          await cards.getByRole('button', { name: 'Bigger cards', exact: true }).click();
          await cards.getByRole('button', { name: 'Bigger cards', exact: true }).click();
          await frames();
          const grip = await cards.locator('[class*="cursor-grab"]').boundingBox();
          await page.mouse.move(grip.x + 10, grip.y + 16);
          await page.mouse.down();
          await page.mouse.move(viewport.width / 2, viewport.height - 2, { steps: 8 });
          await page.mouse.up();
          await frames();
          const bounds = await page.locator('.floating-card-bounds').boundingBox();
          const moved = await cards.boundingBox();
          assert.ok(
            moved.y + moved.height <= bounds.y + bounds.height + 1,
            'Drag stays above controls',
          );
          assert.ok(
            await reachable(buttons[0]),
            'Deal stays clickable after resizing and dragging enlarged cards',
          );
          // The next result remounts from an old position that was saved outside
          // today's viewport. It must be clamped without needing a manual drag.
          await page.evaluate(() =>
            localStorage.setItem('4am-cards-pos', JSON.stringify({ x: 800, y: 800 })),
          );
        }
        console.log(
          `${mode} ${viewport.width}×${viewport.height} ${kind}: visible, clickable Deal; single dismissible recap`,
        );
      }
    }
    await ctx.close();
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
} finally {
  await browser.close();
}
