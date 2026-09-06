import { useId, useState } from 'react';
import { ChartCard, ChartLegend } from '@zeus/ui/application';
import { useReducedMotion } from 'motion/react';
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

const ACCENT = 'var(--color-accent-500)';
const GRID = 'var(--color-border-button-default)';
const MUTED = 'var(--color-text-tertiary)';

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
      <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
        {value}
      </div>
    </div>
  );
}

/** Cumulative winnings over time: one indigo series, gradient fill, zero line. */
export function NetAreaChart({
  points,
  hands = 0,
}: {
  points: { ts: number; net: number }[];
  hands?: number;
}) {
  const [range, setRange] = useState('all');
  const reducedMotion = useReducedMotion();
  const fillId = 'net-' + useId().replace(/:/g, '');
  const filtered =
    range === 'all'
      ? points
      : points.filter((point) => point.ts >= Date.now() - Number(range) * 86400_000);
  const value = points.at(-1)?.net ?? 0;
  const INDIGO = ACCENT;
  // short sessions read better as times, long histories as dates
  const spanMs = points.length > 1 ? points[points.length - 1]!.ts - points[0]!.ts : 0;
  const asTime = spanMs < 48 * 3600_000;
  const tickLabel = (ts: number) =>
    asTime
      ? new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <ChartCard
      label="Net winnings"
      value={value}
      formatValue={(v) => (v > 0 ? '+' : '') + fmt(v)}
      caption={
        hands ? fmt(hands) + ' hands played · chips' : 'Your results appear after your first hand'
      }
      height="auto"
      className="zeus-chart"
      action={
        <select
          aria-label="Winnings time range"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="all">All time</option>
          <option value="30">Last 30 days</option>
          <option value="7">Last 7 days</option>
        </select>
      }
    >
      {filtered.length === 0 ? (
        <div className="zeus-chart-empty" role="status">
          <span className="font-medium">
            {points.length ? 'No hands in this period' : 'Your next poker night starts here'}
          </span>
          <span>
            {points.length
              ? 'Choose a longer period to see your results.'
              : 'Create or join a table to start your history.'}
          </span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={filtered} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
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
              domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]}
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
              fill={`url(#${fillId})`}
              isAnimationActive={!reducedMotion}
              animationDuration={400}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
      <ChartLegend entries={[{ label: 'Cumulative chips', color: ACCENT }]} />
      {filtered.length > 0 && (
        <details className="mt-3 text-xs text-text-secondary">
          <summary className="w-fit cursor-pointer rounded py-1">View chart data</summary>
          <div className="mt-2 max-h-48 overflow-auto">
            <table className="w-full text-left tabular-nums">
              <caption className="sr-only">Net winnings over time</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-2">
                    Date
                  </th>
                  <th scope="col" className="text-right">
                    Net chips
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((point, index) => (
                  <tr
                    key={point.ts + '-' + index}
                    className="border-t border-border-button-default"
                  >
                    <td className="py-2">{new Date(point.ts).toLocaleString()}</td>
                    <td className="text-right">{fmt(point.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </ChartCard>
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
  const INDIGO = ACCENT;
  const reducedMotion = useReducedMotion();
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
        <Radar
          isAnimationActive={!reducedMotion}
          dataKey="value"
          stroke={INDIGO}
          strokeWidth={2}
          fill={INDIGO}
          fillOpacity={0.25}
          animationDuration={600}
        />
        <Tooltip
          content={
            <ChartTooltip format={(label, value) => [String(label ?? ''), `${value} / 100`]} />
          }
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
