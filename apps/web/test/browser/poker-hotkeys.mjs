/** Browser regression against Vite; synthetic room and mocked transport only.
 * BASE_URL, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE and UAT_OUTPUT are configurable.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://localhost:5181';
const out = process.env.UAT_OUTPUT || '/tmp/4am-hotkeys-regression';
await mkdir(out, { recursive: true });
const sharedPath = fileURLToPath(
  new URL('../../../../packages/shared/src/index.ts', import.meta.url),
);
const defaults = {
  enabled: true,
  bindings: { fold: 'F', check: 'X', call: 'C', raise: 'R', halfPot: '2', pot: '3', allIn: 'I' },
};
const room = {
  t: 'room_state',
  room: {
    id: 'hotkey-test',
    name: 'Keyboard table',
    joinCode: 'KEYSQA',
    hostId: 1,
    bankerId: 1,
    sb: 10,
    bb: 20,
    auditMode: 'private',
    actionTimeoutMs: 0,
    actionSecs: 0,
    coBankerId: null,
    minSettleHands: 0,
    sevenDeuceBonus: 0,
    voided: false,
    meetLink: null,
    autoApproveBuys: false,
    tvReplays: false,
    commissionBps: 50,
  },
  players: [0, 1].map((seat) => ({
    seat,
    userId: seat + 1,
    username: ['alex', 'meera'][seat],
    displayName: ['Alex', 'Meera'][seat],
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
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  ],
});
const errors = [];
try {
  for (const mode of ['2d', '3d']) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript(() => {
      localStorage.setItem(
        '4am-auth',
        JSON.stringify({
          state: { auth: { token: 'local-fixture', userId: 1, username: 'alex', identity: null } },
          version: 0,
        }),
      );
      localStorage.setItem('4am-sounds', 'off');
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => errors.push(e.message));
    let saved = structuredClone(defaults);
    await page.route('**/api/**', (route) => {
      if (route.request().method() === 'PUT' && route.request().url().endsWith('/api/profile'))
        saved = route.request().postDataJSON().pokerHotkeys;
      return route.fulfill({
        json: {
          ok: true,
          userId: 1,
          username: 'alex',
          displayName: 'Alex',
          pokerHotkeys: saved,
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
      });
    });
    const sent = [];
    await page.routeWebSocket('**/*', (ws) =>
      ws.onMessage((data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'action') sent.push(msg);
        if (msg.t === 'join_room') ws.send(JSON.stringify(room));
      }),
    );
    await page.goto(`${base}/room/${room.room.id}${mode === '3d' ? '/3d' : ''}`);
    await page.getByRole('button', { name: 'Edit keyboard shortcuts', exact: true }).waitFor();
    await page.evaluate(async (path) => {
      const { useStore, emptyHand } = await import('/src/shared/store.ts');
      const { startHand, applyAction } = await import('/@fs' + path);
      const { deriveIdentity } = await import('/src/shared/crypto.ts');
      window.qa = { store: useStore, empty: emptyHand, startHand, applyAction };
      useStore
        .getState()
        .setAuth({ ...useStore.getState().auth, identity: deriveIdentity('alex', 'local-test') });
    }, sharedPath);
    await page.waitForFunction(() => !!qa.store.getState().room && qa.store.getState().wsConnected);
    let n = 0;
    const prepare = async (kind = 'call') => {
      await page.evaluate(() => {
        document.activeElement?.blur();
        qa.store.setState({ hand: { ...qa.empty } });
      });
      await page.waitForTimeout(50);
      await page.evaluate(
        ({ kind, n, defaults }) => {
          const seats = [
            { seat: 0, stack: 2000 },
            { seat: 1, stack: 2000 },
          ];
          let betting = qa.startHand(
            kind === 'check' ? seats.reverse() : seats,
            kind === 'check' ? 1 : 0,
            10,
            20,
          );
          if (kind === 'check') betting = qa.applyAction(betting, 1, { type: 'call' });
          if (kind === 'other') betting = qa.applyAction(betting, 0, { type: 'call' });
          qa.store.getState().setPokerHotkeys(defaults, 1);
          qa.store.setState({
            wsConnected: true,
            hand: {
              ...qa.empty,
              handId: 'hotkey-' + n,
              actionSeq: n,
              betting,
              seats: qa.store.getState().room.players,
              myCards: [1, 2],
            },
          });
        },
        { kind, n: ++n, defaults },
      );
      await page.waitForTimeout(500);
      sent.length = 0;
    };
    const press = async (key) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    };
    const amount = page.getByRole('spinbutton', { name: 'Bet or raise amount' });
    const noSend = (label) => assert.equal(sent.length, 0, `${mode}: ${label}`);
    await prepare();
    await press('x');
    noSend('check never calls');
    await press('c');
    assert.deepEqual(
      sent.map((s) => s.action),
      [{ type: 'call' }],
    );
    await press('f');
    assert.equal(sent.length, 1, 'pending action blocks further keys');
    await prepare('check');
    await press('c');
    noSend('call never substitutes check');
    await press('x');
    assert.deepEqual(
      sent.map((s) => s.action),
      [{ type: 'check' }],
    );
    await prepare('other');
    for (const k of ['f', 'x', 'c', 'r', 'i']) await press(k);
    noSend('out of turn does not fire');
    assert.equal(await page.evaluate(() => qa.store.getState().hand.preAction), null);
    for (const [key, value] of [
      ['r', 40],
      ['2', 40],
      ['3', 60],
      ['i', 2000],
    ]) {
      await prepare();
      await press(key);
      noSend('sizing only prepares');
      assert.equal(await amount.inputValue(), String(value));
      assert.equal(await amount.evaluate((e) => e === document.activeElement), true);
      await amount.press('Enter');
      await page.waitForTimeout(80);
      assert.deepEqual(
        sent.map((s) => s.action),
        [{ type: 'raise', amount: value }],
      );
    }
    await prepare();
    await press('r');
    await amount.fill('');
    await amount.press('Enter');
    noSend('empty amount rejected');
    await amount.fill('20');
    await amount.press('Enter');
    noSend('too small rejected');
    await amount.fill('2001');
    await amount.press('Enter');
    noSend('too large rejected');
    await amount.fill('60.5');
    await amount.press('Enter');
    noSend('fractional chip rejected');
    await amount.fill('60');
    await amount.press('Escape');
    await press('Enter');
    noSend('escape cancels amount focus');
    await prepare();
    await press('r');
    await page.evaluate(() => qa.store.getState().patchHand({ actionSeq: 999 }));
    await press('Enter');
    noSend('stale amount cannot confirm after turn advances');
    await prepare();
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', repeat: true, bubbles: true }));
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', isComposing: true, bubbles: true }),
      );
    });
    for (const k of ['Control+f', 'Meta+f', 'Alt+f', 'w', 'a', 's', 'd']) await press(k);
    noSend('repeat composition browser and movement keys ignored');
    await prepare();
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    });
    await page.waitForTimeout(80);
    assert.equal(sent.length, 1, 'synchronous duplicate guard');
    assert.equal(sent[0].action.type, 'fold');
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      await prepare();
      await page.evaluate((tag) => {
        const e = document.createElement(tag);
        e.id = 'qa-typing';
        if (tag === 'div') e.contentEditable = 'true';
        document.body.appendChild(e);
        e.focus();
      }, tag);
      await press('f');
      noSend('typing in ' + tag);
      await page.evaluate(() => document.getElementById('qa-typing').remove());
    }
    for (const field of ['disabled', 'unloaded', 'disconnected', 'hidden']) {
      await prepare();
      await page.evaluate((field) => {
        const s = qa.store.getState();
        if (field === 'disabled') s.setPokerHotkeys({ ...s.prefs.pokerHotkeys, enabled: false }, 1);
        if (field === 'unloaded') qa.store.setState({ pokerHotkeysFor: null });
        if (field === 'disconnected') qa.store.setState({ wsConnected: false });
        if (field === 'hidden')
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      }, field);
      await press('f');
      noSend(field + ' shortcuts blocked');
      if (field === 'hidden') await page.evaluate(() => delete document.hidden);
    }
    await prepare();
    await page.evaluate(() => {
      qa.store.getState().patchHand({
        actionSeq: qa.store.getState().hand.actionSeq + 1,
        betting: qa.applyAction(qa.store.getState().hand.betting, 0, { type: 'call' }),
      });
    });
    await page.waitForTimeout(30);
    await page.evaluate(() =>
      qa.store.getState().patchHand({
        actionSeq: qa.store.getState().hand.actionSeq + 1,
        betting: qa.startHand(
          [
            { seat: 0, stack: 2000 },
            { seat: 1, stack: 2000 },
          ],
          0,
          10,
          20,
        ),
      }),
    );
    await press('f');
    noSend('settling guard');
    await page.waitForTimeout(450);
    await press('f');
    assert.equal(sent.length, 1);
    await prepare();
    await page.getByRole('button', { name: 'Edit keyboard shortcuts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
    await dialog.getByLabel('Shortcut for Fold', { exact: true }).waitFor();
    await page.evaluate(() => document.activeElement?.blur());
    await press('f');
    noSend('dialog blocks actions');
    await dialog.getByRole('button', { name: 'Record Fold shortcut', exact: true }).click();
    await press('Shift+3');
    assert.equal(
      await dialog.getByLabel('Shortcut for Fold', { exact: true }).inputValue(),
      'Shift+3',
    );
    await dialog.getByRole('button', { name: 'Save shortcuts', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'saved to your account' }).waitFor();
    await press('Escape');
    await press('f');
    noSend('old binding removed');
    await press('Shift+3');
    assert.equal(sent.length, 1, 'recorded shifted digit works');
    await prepare();
    await page.evaluate(() => {
      const menu = document.createElement('div');
      menu.id = 'qa-menu';
      menu.setAttribute('role', 'menu');
      menu.textContent = 'Menu';
      document.body.appendChild(menu);
    });
    await press('f');
    noSend('menu blocks actions');
    await page.evaluate(() => document.getElementById('qa-menu').remove());
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await prepare();
      await press('r');
      await amount.scrollIntoViewIfNeeded();
      const box = await amount.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, 'amount stays on screen');
      await page.screenshot({ path: `${out}/${mode}-amount-${width}.png` });
      await amount.press('Escape');
      await page.getByRole('button', { name: 'Edit keyboard shortcuts', exact: true }).click();
      await dialog.getByLabel('Shortcut for Fold', { exact: true }).waitFor();
      assert.ok(
        await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth),
        'dialog has no horizontal overflow',
      );
      await page.screenshot({ path: `${out}/${mode}-editor-${width}.png` });
      await press('Escape');
    }
    console.log(
      `PASS ${mode}: actions, amounts, typing, dialogs, repeats, pending, turn changes, account readiness, recording and responsive UI`,
    );
    await ctx.close();
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
} finally {
  await browser.close();
}
