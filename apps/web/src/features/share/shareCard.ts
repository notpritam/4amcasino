import { RANKS, rankOf, suitOf, type CardId } from '@4am/shared';

/** Everything the shareable result image needs; all of it is public info. */
export interface ShareRow {
  name: string;
  cards: CardId[] | null; // null = the cards were never shown
  label: string | null; // hand description, e.g. "Two Pair, Aces and Kings"
  delta: number;
}

export interface ShareData {
  roomName: string;
  headline: string;
  board: CardId[];
  rows: ShareRow[];
  winningFive: CardId[] | null;
}

const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'] as const;
const SUIT_COLORS = ['#1e293b', '#e11d48', '#e11d48', '#1e293b'] as const;
const GOLD = '#5cff72';

function rankLabel(id: CardId): string {
  const r = RANKS[rankOf(id)]!;
  return r === 'T' ? '10' : r;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  id: CardId | null,
  highlight: boolean,
): void {
  const r = w * 0.14;
  ctx.save();
  // the theme's magenta offset shadow instead of a soft drop
  ctx.shadowColor = 'rgba(255,60,142,0.5)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = w * 0.05;
  ctx.shadowOffsetY = w * 0.055;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = id === null ? '#0e4d20' : '#ffffff';
  ctx.fill();
  ctx.restore();
  if (id === null) {
    // face-down back: diagonal hatching
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = w * 0.045;
    for (let i = -h; i < w + h; i += w * 0.22) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.save();
    const color = SUIT_COLORS[suitOf(id)]!;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${w * 0.34}px "Unbounded", system-ui, sans-serif`;
    ctx.fillText(rankLabel(id), x + w * 0.11, y + w * 0.42);
    ctx.textAlign = 'center';
    ctx.font = `${w * 0.52}px system-ui, sans-serif`;
    ctx.fillText(SUIT_GLYPHS[suitOf(id)]!, x + w / 2, y + h * 0.82);
    ctx.restore();
  }
  if (highlight) {
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, r + 3);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 5;
    ctx.stroke();
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

const fmtChips = (n: number) => new Intl.NumberFormat('en-US').format(n);

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}\u2026`).width > maxWidth) t = t.slice(0, -1);
  return `${t}\u2026`;
}

/** Subtle film grain over the finished card. */
function grain(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(off, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** One duel column: avatar, name, cards, hand label, hero delta. */
function drawColumn(
  ctx: CanvasRenderingContext2D,
  cx: number,
  row: ShareRow,
  five: Set<CardId>,
  dim: boolean,
): void {
  ctx.save();
  if (dim) ctx.globalAlpha = 0.72;
  const winner = row.delta > 0;
  // avatar
  ctx.beginPath();
  ctx.arc(cx, 178, 28, 0, Math.PI * 2);
  ctx.fillStyle = winner ? '#5cff72' : 'rgba(255,255,255,0.10)';
  ctx.fill();
  ctx.fillStyle = winner ? '#041007' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '700 26px "Unbounded", system-ui, sans-serif';
  ctx.fillText(row.name.slice(0, 1).toUpperCase(), cx, 188);
  // name
  ctx.font = '600 27px "JetBrains Mono", system-ui, monospace';
  ctx.fillText(ellipsize(ctx, row.name, 320), cx, 243);
  // cards
  const cw = 96;
  const ch = 134;
  const gap = 12;
  const startX = cx - cw - gap / 2;
  if (row.cards) {
    row.cards.forEach((c, j) =>
      drawCardFace(ctx, startX + j * (cw + gap), 262, cw, ch, c, five.has(c)),
    );
  } else {
    for (let j = 0; j < 2; j++) drawCardFace(ctx, startX + j * (cw + gap), 262, cw, ch, null, false);
  }
  // hand label
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '21px "JetBrains Mono", system-ui, monospace';
  ctx.fillText(row.label ?? (row.cards ? '' : 'never shown'), cx, 428);
  // hero delta
  ctx.fillStyle = winner ? '#5cff72' : '#ff5aa6';
  ctx.font = '700 54px "Unbounded", system-ui, sans-serif';
  ctx.fillText(`${winner ? '+' : '\u2212'}${fmtChips(Math.abs(row.delta))}`, cx, 492);
  ctx.restore();
}

/** Renders the 1200x630 shareable hand card onto the canvas. */
export function drawHandCard(canvas: HTMLCanvasElement, data: ShareData): void {
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const five = new Set(data.winningFive ?? []);

  // background: near-black with a faint indigo glow behind the duel
  ctx.fillStyle = '#050a07';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 300, 60, W / 2, 300, 560);
  glow.addColorStop(0, 'rgba(92,255,114,0.12)');
  glow.addColorStop(1, 'rgba(92,255,114,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // quiet brand row
  ctx.fillStyle = '#5cff72';
  roundRect(ctx, 48, 38, 34, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#041007';
  ctx.textAlign = 'center';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText('\u2660', 65, 62);
  ctx.textAlign = 'left';
  ctx.font = '700 19px "Unbounded", system-ui, sans-serif';
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '4px';
  } catch {
    /* older browsers */
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('4AM CASINO', 96, 61);
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  } catch {
    /* older browsers */
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '18px "JetBrains Mono", system-ui, monospace';
  ctx.fillText(ellipsize(ctx, data.roomName, 360), W - 48, 61);

  // headline, one quiet line
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '500 23px "JetBrains Mono", system-ui, monospace';
  ctx.fillText(ellipsize(ctx, data.headline, W - 140), W / 2, 112);

  // the duel: winner vs the biggest loser
  const rows = data.rows;
  const winnerRow = rows[0];
  const loserRow = rows.length > 1 ? rows[rows.length - 1] : null;
  if (winnerRow && loserRow) {
    // center divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 160);
    ctx.lineTo(W / 2, 500);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, 320, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#0a130e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.font = '600 19px "JetBrains Mono", system-ui, monospace';
    ctx.fillText('vs', W / 2, 327);
    drawColumn(ctx, W * 0.27, winnerRow, five, false);
    drawColumn(ctx, W * 0.73, loserRow, five, true);
  } else if (winnerRow) {
    drawColumn(ctx, W / 2, winnerRow, five, false);
  }

  // the board, small and quiet, winning five ringed
  const bw = 62;
  const bh = 87;
  const gap = 12;
  const startX = (W - (5 * bw + 4 * gap)) / 2;
  for (let i = 0; i < 5; i++) {
    const card = data.board[i];
    if (card !== undefined) {
      drawCardFace(ctx, startX + i * (bw + gap), 516, bw, bh, card, five.has(card));
    } else {
      roundRect(ctx, startX + i * (bw + gap), 516, bw, bh, 9);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // quiet footer: everyone else, and the promise
  const others = rows.slice(1, -1);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = '15px "JetBrains Mono", system-ui, monospace';
  if (others.length > 0) {
    const line = others
      .map((o) => `${o.name} ${o.delta > 0 ? '+' : '\u2212'}${fmtChips(Math.abs(o.delta))}`)
      .join('  \u00b7  ');
    ctx.fillText(ellipsize(ctx, `also in the pot: ${line}`, 560), 48, H - 20);
  }
  ctx.textAlign = 'right';
  ctx.fillText('provably fair \u00b7 nobody sees your cards, not even the house', W - 48, H - 20);

  grain(ctx, W, H);
}
