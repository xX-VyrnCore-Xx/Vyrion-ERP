/** Small dependency-free charts drawn in SVG with the theme's colours. */

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** "2026-03" → "mar". */
export const monthLabel = (month: string): string => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

export interface BarDatum {
  label: string;
  value: number;
  /** Shown as the tooltip of the bar. */
  title: string;
}

/**
 * Vertical bars. The last bar (the current period) is drawn in full colour, the others softer.
 * The chart is described for assistive technology by `summary`.
 */
export function BarChart({ data, summary }: { data: BarDatum[]; summary: string }) {
  const width = 640;
  const height = 190;
  const top = 12;
  const bottom = 24;
  const max = Math.max(1, ...data.map((d) => Math.max(0, d.value)));
  const slot = width / Math.max(1, data.length);
  const bar = Math.min(34, slot * 0.58);
  const plot = height - top - bottom;
  return (
    <svg
      role="img"
      aria-label={summary}
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={0}
          x2={width}
          y1={top + plot * (1 - f)}
          y2={top + plot * (1 - f)}
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="3 5"
          opacity={0.7}
        />
      ))}
      <line x1={0} x2={width} y1={top + plot} y2={top + plot} stroke="var(--border)" />
      {data.map((d, i) => {
        const h = Math.round((Math.max(0, d.value) / max) * plot);
        const x = i * slot + (slot - bar) / 2;
        const last = i === data.length - 1;
        return (
          <g key={d.label + i}>
            <title>{d.title}</title>
            <rect
              x={x}
              y={top + plot - Math.max(h, d.value > 0 ? 2 : 0)}
              width={bar}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx={4}
              fill="var(--accent)"
              opacity={last ? 1 : 0.5}
            />
            <text
              x={x + bar / 2}
              y={height - 7}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** Tailwind background class of the segment and of its legend dot. */
  tone: string;
}

/** One horizontal bar split in proportion, with a legend that carries the figures. */
export function StackedBar({
  segments,
  format,
  empty,
}: {
  segments: Segment[];
  format: (value: number) => string;
  empty: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div>
      <div
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join(", ")}
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-raised"
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.key}
              title={`${s.label}: ${format(s.value)}`}
              className={`${s.tone} first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="mt-4 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted">
              <span aria-hidden="true" className={`size-2 rounded-full ${s.tone}`} />
              {s.label}
            </span>
            <span className="tabular-nums text-fg">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
