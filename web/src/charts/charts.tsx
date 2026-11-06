import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AttendanceAnalytics,
  CourseComparison,
  RiskDistribution,
  ScoreTrends,
  StudentProgress,
} from '../types/api';
import {
  ChartCard,
  SERIES,
  STATUS,
  TooltipBox,
  axisProps,
  gridProps,
  percentDomain,
  percentTicks,
  shortDate,
  weekOf,
} from './ChartKit';

const pct = (v: number) => `${v}%`;
const activeDot = { r: 5, strokeWidth: 2, stroke: 'var(--surface)' };

// ── Average score trend (overall or per course) ─────────────────────────────
export function ScoreTrendChart({ data }: { data: ScoreTrends }) {
  const [mode, setMode] = useState<'overall' | 'course'>('overall');
  // Up to 8 courses get fixed slots in course order; colors follow the course, not its rank.
  const courses = data.byCourse.slice(0, 8);
  const periods = data.overall.map((p) => p.period);
  const rows = periods.map((period) => {
    const row: Record<string, string | number | null> = {
      period,
      overall: data.overall.find((o) => o.period === period)?.averagePercent ?? null,
    };
    for (const c of courses)
      row[c.code] = c.points.find((p) => p.period === period)?.averagePercent ?? null;
    return row;
  });
  const values =
    mode === 'overall'
      ? data.overall.map((o) => o.averagePercent)
      : courses.flatMap((c) => c.points.map((p) => p.averagePercent));

  return (
    <ChartCard
      title="Average score trend"
      subtitle="Weighted average score of assessments due each week"
      legend={
        mode === 'course'
          ? courses.map((c, i) => ({ label: c.code, color: SERIES[i]!, shape: 'line' }))
          : undefined
      }
      controls={
        courses.length > 1 && (
          <div className="segmented" role="group" aria-label="Trend grouping">
            <button aria-pressed={mode === 'overall'} onClick={() => setMode('overall')}>
              All
            </button>
            <button aria-pressed={mode === 'course'} onClick={() => setMode('course')}>
              By course
            </button>
          </div>
        )
      }
      table={{
        columns: ['Week', ...(mode === 'overall' ? ['Average'] : courses.map((c) => c.code))],
        rows: rows.map((r) =>
          [
            weekOf(r.period),
            ...(mode === 'overall' ? [r.overall] : courses.map((c) => r[c.code] ?? null)),
          ].map((v, i) => (i > 0 && v !== null ? `${v}%` : v)),
        ),
      }}
    >
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" tickFormatter={shortDate} {...axisProps} />
            <YAxis
              domain={percentDomain(values)}
              ticks={percentTicks(values)}
              tickFormatter={pct}
              {...axisProps}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: 'var(--text-3)', strokeWidth: 1 }}
              content={(p) => <TooltipBox {...p} format={pct} labelFormat={weekOf} />}
            />
            {mode === 'overall' ? (
              <Line
                type="monotone"
                dataKey="overall"
                name="Average"
                stroke={SERIES[0]}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: SERIES[0] }}
                activeDot={activeDot}
                connectNulls
              />
            ) : (
              courses.map((c, i) => (
                <Line
                  key={c.code}
                  type="monotone"
                  dataKey={c.code}
                  name={c.code}
                  stroke={SERIES[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={activeDot}
                  connectNulls
                />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ── Course comparison (one metric at a time: one axis, one color) ───────────
const METRICS = {
  averageScore: 'Average score',
  attendanceRate: 'Attendance',
  completionRate: 'Completion',
} as const;
type Metric = keyof typeof METRICS;

export function CourseComparisonChart({ data }: { data: CourseComparison[] }) {
  const [metric, setMetric] = useState<Metric>('averageScore');
  const rows = data.map((c) => ({ code: c.code, value: c[metric] }));
  const height = Math.max(160, data.length * 44 + 30);
  return (
    <ChartCard
      title="Course comparison"
      subtitle={`${METRICS[metric]} by course`}
      controls={
        <select
          className="select"
          value={metric}
          onChange={(e) => setMetric(e.target.value as Metric)}
          aria-label="Comparison metric"
        >
          {Object.entries(METRICS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      }
      table={{
        columns: ['Course', 'Students', 'Avg score', 'Attendance', 'Completion', 'High risk'],
        rows: data.map((c) => [
          c.code,
          c.students,
          c.averageScore && `${c.averageScore}%`,
          c.attendanceRate && `${c.attendanceRate}%`,
          c.completionRate && `${c.completionRate}%`,
          c.risk.HIGH,
        ]),
      }}
    >
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
          >
            <CartesianGrid {...gridProps} vertical horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tickFormatter={pct} {...axisProps} />
            <YAxis type="category" dataKey="code" {...axisProps} width={76} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(p) => <TooltipBox {...p} format={pct} />}
            />
            <Bar
              dataKey="value"
              name={METRICS[metric]}
              fill={SERIES[0]}
              barSize={20}
              radius={[0, 4, 4, 0]}
            >
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v) => (v == null ? '' : `${v}%`)}
                style={{ fill: 'var(--text-2)', fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ── Attendance ──────────────────────────────────────────────────────────────
const ATT = [
  { key: 'present', label: 'Present', color: SERIES[0]! },
  { key: 'late', label: 'Late', color: SERIES[2]! },
  { key: 'absent', label: 'Absent', color: SERIES[1]! },
  { key: 'excused', label: 'Excused', color: 'var(--neutral-mark)' },
] as const;

export function AttendanceChart({ data }: { data: AttendanceAnalytics }) {
  return (
    <ChartCard
      title="Attendance by week"
      subtitle="Class-meeting records per week (late counts as attended)"
      legend={ATT.map((a) => ({ label: a.label, color: a.color }))}
      table={{
        columns: ['Week', 'Present', 'Late', 'Absent', 'Excused', 'Rate'],
        rows: data.weekly.map((w) => [
          weekOf(w.period),
          w.present,
          w.late,
          w.absent,
          w.excused,
          w.attendanceRate && `${w.attendanceRate}%`,
        ]),
      }}
    >
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data.weekly} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" tickFormatter={shortDate} {...axisProps} />
            <YAxis allowDecimals={false} {...axisProps} width={44} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(p) => <TooltipBox {...p} labelFormat={weekOf} />}
            />
            {ATT.map((a, i) => (
              <Bar
                key={a.key}
                dataKey={a.key}
                name={a.label}
                stackId="att"
                fill={a.color}
                barSize={24}
                stroke="var(--surface)"
                strokeWidth={2}
                radius={i === ATT.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function AttendanceBandsChart({ data }: { data: AttendanceAnalytics }) {
  return (
    <ChartCard
      title="Attendance rate distribution"
      subtitle="Number of student-course enrollments in each attendance band"
      table={{
        columns: ['Attendance band', 'Enrollments'],
        rows: data.distribution.map((d) => [`${d.band}%`, d.count]),
      }}
    >
      <div className="chart chart-sm">
        <ResponsiveContainer>
          <BarChart data={data.distribution} margin={{ top: 16, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="band" tickFormatter={(b) => `${b}%`} {...axisProps} />
            <YAxis allowDecimals={false} {...axisProps} width={44} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(p) => <TooltipBox {...p} labelFormat={(l) => `${l}% attendance`} />}
            />
            <Bar
              dataKey="count"
              name="Enrollments"
              fill={SERIES[0]}
              barSize={24}
              radius={[4, 4, 0, 0]}
            >
              <LabelList
                dataKey="count"
                position="top"
                style={{ fill: 'var(--text-2)', fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ── Risk distribution (status colors + icons + labels) ──────────────────────
const LEVELS = [
  { key: 'LOW', label: 'Low', icon: '●' },
  { key: 'MEDIUM', label: 'Medium', icon: '▲' },
  { key: 'HIGH', label: 'High', icon: '■' },
] as const;
export const RULE_LABEL: Record<string, string> = {
  recentPerformance: 'Low recent performance',
  decliningTrend: 'Declining grades',
  attendance: 'Low attendance',
  completion: 'Missing work',
};

export function RiskDistributionChart({ data }: { data: RiskDistribution }) {
  return (
    <ChartCard
      title="At-risk students by course"
      subtitle="Current early-warning level of each enrollment"
      legend={LEVELS.map((l) => ({ label: `${l.label} risk`, color: STATUS[l.key], icon: l.icon }))}
      table={{
        columns: ['Course', 'Low', 'Medium', 'High'],
        rows: data.byCourse.map((c) => [c.code, c.LOW, c.MEDIUM, c.HIGH]),
      }}
    >
      <div style={{ height: Math.max(160, data.byCourse.length * 44 + 30) }}>
        <ResponsiveContainer>
          <BarChart
            data={data.byCourse}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid {...gridProps} vertical horizontal={false} />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis type="category" dataKey="code" {...axisProps} width={76} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={(p) => <TooltipBox {...p} />} />
            {LEVELS.map((l, i) => (
              <Bar
                key={l.key}
                dataKey={l.key}
                name={`${l.label} risk`}
                stackId="risk"
                fill={STATUS[l.key]}
                barSize={20}
                stroke="var(--surface)"
                strokeWidth={2}
                radius={i === 2 ? [0, 4, 4, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {data.topFactors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>
            Most common reasons (medium &amp; high)
          </div>
          <div className="row">
            {data.topFactors.map((f) => (
              <span className="badge" key={f.rule}>
                {RULE_LABEL[f.rule] ?? f.rule} <span className="num">{f.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// ── Single student: score vs class average ──────────────────────────────────
export function StudentScoreChart({ timeline }: { timeline: StudentProgress['timeline'] }) {
  // One course at a time: mixing courses on one line would zig-zag between unrelated scales.
  const codes = [...new Set(timeline.map((t) => t.courseCode))];
  const [selected, setSelected] = useState<string>(codes[0] ?? '');
  const courseCode = codes.includes(selected) ? selected : codes[0];
  const rows = timeline
    .filter((t) => !courseCode || t.courseCode === courseCode)
    .map((t) => ({ ...t, label: courseCode ? t.title : `${t.courseCode} · ${t.title}` }));
  const legend = [
    { label: 'Student', color: SERIES[0]!, shape: 'line' as const },
    { label: 'Class average', color: 'var(--neutral-mark)', shape: 'line' as const },
  ];
  return (
    <ChartCard
      title="Scores vs. class average"
      subtitle="Each point is one graded assessment, in due-date order"
      legend={legend}
      controls={
        codes.length > 1 && (
          <select
            className="select"
            aria-label="Course"
            value={courseCode}
            onChange={(e) => setSelected(e.target.value)}
          >
            {codes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )
      }
      table={{
        columns: ['Assessment', 'Due', 'Score', 'Class avg', 'Status'],
        rows: rows.map((r) => [
          r.label,
          shortDate(r.dueDate),
          r.percent && `${r.percent}%`,
          r.classAverage && `${r.classAverage}%`,
          r.status,
        ]),
      }}
    >
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="dueDate" tickFormatter={shortDate} {...axisProps} minTickGap={16} />
            <YAxis
              domain={percentDomain(rows.flatMap((r) => [r.percent, r.classAverage]))}
              ticks={percentTicks(rows.flatMap((r) => [r.percent, r.classAverage]))}
              tickFormatter={pct}
              {...axisProps}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: 'var(--text-3)', strokeWidth: 1 }}
              content={(p) => (
                <TooltipBox
                  {...p}
                  format={pct}
                  labelFormat={() =>
                    String((p.payload?.[0]?.payload as { label?: string })?.label ?? '')
                  }
                />
              )}
            />
            <Line
              type="monotone"
              dataKey="classAverage"
              name="Class average"
              stroke="var(--neutral-mark)"
              strokeWidth={2}
              dot={false}
              activeDot={activeDot}
            />
            <Line
              type="monotone"
              dataKey="percent"
              name="Student"
              stroke={SERIES[0]}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: SERIES[0] }}
              activeDot={activeDot}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function StudentAttendanceChart({
  weekly,
}: {
  weekly: StudentProgress['attendanceWeekly'];
}) {
  return (
    <ChartCard
      title="Weekly attendance"
      subtitle="Share of class meetings attended each week, across courses"
      table={{
        columns: ['Week', 'Attendance'],
        rows: weekly.map((w) => [weekOf(w.period), w.attendanceRate && `${w.attendanceRate}%`]),
      }}
    >
      <div className="chart chart-sm">
        <ResponsiveContainer>
          <BarChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" tickFormatter={shortDate} {...axisProps} />
            <YAxis domain={[0, 100]} tickFormatter={pct} {...axisProps} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(p) => <TooltipBox {...p} format={pct} labelFormat={weekOf} />}
            />
            <Bar
              dataKey="attendanceRate"
              name="Attendance"
              fill={SERIES[0]}
              barSize={20}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
