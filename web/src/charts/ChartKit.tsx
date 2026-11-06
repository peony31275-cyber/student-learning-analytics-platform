/**
 * Shared chart building blocks so every chart follows the same rules:
 * recessive hairline grid, text in text tokens (never series colors),
 * a legend for 2+ series, a hover tooltip, and a table view of the same data.
 */
import { type ReactNode, useState } from 'react';

export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];
export const STATUS = {
  LOW: 'var(--good)',
  MEDIUM: 'var(--warning)',
  HIGH: 'var(--critical)',
} as const;

export const axisProps = {
  stroke: 'var(--grid)',
  tick: { fill: 'var(--text-2)', fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: 'var(--grid)' },
} as const;
export const gridProps = {
  stroke: 'var(--grid)',
  strokeDasharray: undefined,
  vertical: false,
} as const;

export interface LegendItem {
  label: string;
  color: string;
  shape?: 'box' | 'line';
  icon?: string;
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i
            className={i.shape === 'line' ? 'line' : undefined}
            style={{ background: i.color }}
            aria-hidden="true"
          />
          {i.icon && (
            <span aria-hidden="true" style={{ fontSize: 9 }}>
              {i.icon}
            </span>
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

interface TooltipEntry {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: { fill?: string } & Record<string, unknown>;
}
export interface TooltipBoxProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  format?: (v: number, name: string) => string;
  labelFormat?: (l: unknown) => string;
}

export function TooltipBox({
  active,
  payload,
  label,
  format = (v) => String(v),
  labelFormat = (l) => String(l),
}: TooltipBoxProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{labelFormat(label)}</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div className="tooltip-row" key={String(p.dataKey)}>
            <span>
              <i style={{ background: p.color ?? p.payload?.fill }} />
              {String(p.name)}
            </span>
            <strong className="num">{format(Number(p.value), String(p.name))}</strong>
          </div>
        ))}
    </div>
  );
}

export interface TableSpec {
  columns: string[];
  rows: (string | number | null | undefined)[][];
}

/** Card with a chart/table toggle. The table carries every value, so nothing is gated on color or hover. */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  controls,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: TableSpec;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="subtle">{subtitle}</p>}
        </div>
        <div className="row">
          {controls}
          {table && (
            <div className="segmented" role="group" aria-label={`${title} view`}>
              <button aria-pressed={!asTable} onClick={() => setAsTable(false)}>
                Chart
              </button>
              <button aria-pressed={asTable} onClick={() => setAsTable(true)}>
                Table
              </button>
            </div>
          )}
        </div>
      </div>
      {asTable && table ? (
        <div className="table-wrap" style={{ maxHeight: 300 }}>
          <table className="table">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={i > 0 ? 'right' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((v, i) => (
                    <td key={i} className={i > 0 ? 'right num' : undefined}>
                      {v ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {legend && <Legend items={legend} />}
          {children}
        </>
      )}
    </section>
  );
}

export const shortDate = (iso: unknown) =>
  typeof iso === 'string'
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '';
export const weekOf = (iso: unknown) => `Week of ${shortDate(iso)}`;

/** Round a percent axis outward to clean tens so lines are not visually exaggerated by a tight domain. */
export function percentDomain(values: (number | null | undefined)[]): [number, number] {
  const v = values.filter((x): x is number => typeof x === 'number');
  if (v.length === 0) return [0, 100];
  return [Math.max(0, Math.floor((Math.min(...v) - 5) / 10) * 10), 100];
}

/** Tick every 10 points across the percent domain (clean, readable values). */
export function percentTicks(values: (number | null | undefined)[]): number[] {
  const [lo, hi] = percentDomain(values);
  const step = hi - lo > 50 ? 20 : 10;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  return ticks;
}
