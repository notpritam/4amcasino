import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmt } from '../../shared/lib/cn.ts';
import { useStore } from '../../shared/store.ts';

/** shadcn-style charts, themed with the app's own tokens. */

// recharts wants literal colors, so the accent tracks the theme from the store
function useAccent(): string {
  const theme = useStore((s) => s.prefs.theme);
  return theme === 'cyber' ? '#5cff72' : '#6366f1';
}
const GRID = 'rgba(148, 163, 184, 0.18)';
const MUTED = 'rgba(148, 163, 184, 0.85)';

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string | number;
  format: (label: string | number | undefined, value: number) => [string, string];
}) {
  if (!active || !payload?.length) return null;
  const [title, value] = format(label, payload[0]!.value);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="text-slate-500 dark:text-slate-400">{title}</div>
      <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

/** Cumulative winnings over time: one indigo series, gradient fill, zero line. */
export function NetAreaChart({ points }: { points: { ts: number; net: number }[] }) {
  const INDIGO = useAccent();
  // short sessions read better as times, long histories as dates
  const spanMs = points.length > 1 ? points[points.length - 1]!.ts - points[0]!.ts : 0;
  const asTime = spanMs < 48 * 3600_000;
  const tickLabel = (ts: number) =>
    asTime
      ? new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INDIGO} stopOpacity={0.35} />
            <stop offset="100%" stopColor={INDIGO} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="ts"
          tickFormatter={tickLabel}
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => fmt(v)}
        />
        <ReferenceLine y={0} stroke={GRID} />
        <Tooltip
          content={
            <ChartTooltip
              format={(label, value) => [
                new Date(Number(label)).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                `${value >= 0 ? '+' : '−'}${fmt(Math.abs(value))} chips`,
              ]}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="net"
          stroke={INDIGO}
          strokeWidth={2}
          fill="url(#netFill)"
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface StyleAxes {
  vpipPct: number;
  aggressionFactor: number;
  quietWinPct: number;
  showdownPct: number;
  winPct: number;
}

/** How they play, on five axes. Values are normalized to 0-100. */
export function StyleRadar({ style }: { style: StyleAxes }) {
  const INDIGO = useAccent();
  const data = [
    { axis: 'Loose', value: Math.min(100, style.vpipPct) },
    { axis: 'Aggressive', value: Math.min(100, Math.round(style.aggressionFactor * 33)) },
    { axis: 'Pressure', value: Math.min(100, style.quietWinPct) },
    { axis: 'Showdowns', value: Math.min(100, style.showdownPct) },
    { axis: 'Wins', value: Math.min(100, style.winPct) },
  ];
  return (
    <ResponsiveContainer width="100%" height={230}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={GRID} />
        <PolarAngleAxis dataKey="axis" tick={{ fill: MUTED, fontSize: 12 }} />
        <Radar dataKey="value" stroke={INDIGO} strokeWidth={2} fill={INDIGO} fillOpacity={0.25} animationDuration={600} />
        <Tooltip
          content={<ChartTooltip format={(label, value) => [String(label ?? ''), `${value} / 100`]} />}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
