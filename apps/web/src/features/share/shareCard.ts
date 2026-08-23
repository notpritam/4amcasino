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
const GOLD = '#f59e0b';

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

function drawCardFace(
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
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = w * 0.12;
  ctx.shadowOffsetY = w * 0.05;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = id === null ? '#4f46e5' : '#ffffff';
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
    ctx.font = `700 ${w * 0.34}px "Space Grotesk", system-ui, sans-serif`;
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

/** Renders the 1200x630 shareable hand card onto the canvas. */
export function drawHandCard(canvas: HTMLCanvasElement, data: ShareData): void {
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const five = new Set(data.winningFive ?? []);

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1220');
  bg.addColorStop(1, '#141b33');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(0, 0, W, 8);

  // header
  ctx.fillStyle = '#4f46e5';
  roundRect(ctx, 48, 40, 44, 44, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillText('♠', 70, 72);
  ctx.textAlign = 'left';
  ctx.font = '700 28px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText('4AM CASINO', 106, 71);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '22px "Inter", system-ui, sans-serif';
  ctx.fillText(data.roomName, W - 48, 71);

  // headline
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 30px "Inter", system-ui, sans-serif';
  const lines = wrapText(ctx, data.headline, W - 96);
  lines.forEach((l, i) => ctx.fillText(l, 48, 136 + i * 40));
  const afterHeadline = 136 + (lines.length - 1) * 40;

  // board
  const bw = 104;
  const bh = 146;
  const gap = 18;
  const boardW = 5 * bw + 4 * gap;
  const bx = (W - boardW) / 2;
  const by = afterHeadline + 34;
  for (let i = 0; i < 5; i++) {
    const card = data.board[i];
    if (card !== undefined) {
      drawCardFace(ctx, bx + i * (bw + gap), by, bw, bh, card, five.has(card));
    } else {
      roundRect(ctx, bx + i * (bw + gap), by, bw, bh, 14);
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // player rows
  const rows = data.rows.slice(0, 4);
  const top = by + bh + 36;
  const rowH = Math.min(96, (H - top - 24) / rows.length);
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    const cy = y + rowH / 2;
    const winner = row.delta > 0;
    // accent chip for the initial
    ctx.fillStyle = winner ? '#10b981' : 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(76, cy, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 26px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText(row.name.slice(0, 1).toUpperCase(), 76, cy + 9);
    // name
    ctx.textAlign = 'left';
    ctx.font = '600 28px "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(row.name.slice(0, 16), 122, cy + 10);
    // hole cards (or face-down when never shown)
    const cw = 56;
    const ch = 78;
    const cardsX = 400;
    if (row.cards) {
      row.cards.forEach((c, j) =>
        drawCardFace(ctx, cardsX + j * (cw + 10), cy - ch / 2, cw, ch, c, five.has(c)),
      );
    } else {
      for (let j = 0; j < 2; j++)
        drawCardFace(ctx, cardsX + j * (cw + 10), cy - ch / 2, cw, ch, null, false);
    }
    // hand label (or "never shown")
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '24px "Inter", system-ui, sans-serif';
    ctx.fillText(row.label ?? (row.cards ? '' : 'never shown'), 560, cy + 9);
    // delta
    ctx.textAlign = 'right';
    ctx.fillStyle = row.delta > 0 ? '#34d399' : '#fb7185';
    ctx.font = `700 34px "Space Grotesk", system-ui, sans-serif`;
    ctx.fillText(`${row.delta > 0 ? '+' : '−'}${fmtChips(Math.abs(row.delta))}`, W - 48, cy + 12);
    ctx.textAlign = 'left';
  });

  // footer watermark
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.font = '18px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('provably fair · nobody sees your cards, not even the house', W - 48, H - 18);
  ctx.textAlign = 'left';
}
