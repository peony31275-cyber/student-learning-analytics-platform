/**
 * Pure metric computation for one student in one course.
 * Input is plain data, so it is trivially unit-testable and has no I/O.
 */
export type GradeStatusLike = 'SUBMITTED' | 'LATE' | 'MISSING' | 'EXCUSED';
export type AttendanceStatusLike = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface GradePoint {
  /** Percent 0–100, or null when the work has no score (MISSING/EXCUSED). */
  percent: number | null;
  status: GradeStatusLike;
  weight: number;
  dueDate: Date;
}

export interface RiskMetrics {
  gradedCount: number;
  /** Weighted average % over all scored work. */
  averagePercent: number | null;
  /** Unweighted average % over the most recent `recentWindow` scored items. */
  recentAverage: number | null;
  /** Unweighted average % over the scored items before the recent window. */
  priorAverage: number | null;
  /** recentAverage - priorAverage (negative = declining). */
  trendDelta: number | null;
  /** Least-squares slope in percentage points per assessment (descriptive). */
  trendSlope: number | null;
  attendanceSessions: number;
  attendanceRate: number | null;
  absences: number;
  lates: number;
  completionCount: number;
  completionRate: number | null;
  missingCount: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function linearSlope(ys: number[]): number | null {
  const n = ys.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

export function computeMetrics(
  grades: GradePoint[],
  attendance: AttendanceStatusLike[],
  recentWindow: number,
): RiskMetrics {
  const ordered = [...grades].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const scored = ordered.filter((g): g is GradePoint & { percent: number } => g.percent !== null);
  const percents = scored.map((g) => g.percent);

  const weightSum = scored.reduce((s, g) => s + g.weight, 0);
  const averagePercent =
    scored.length === 0
      ? null
      : weightSum > 0
        ? scored.reduce((s, g) => s + g.percent * g.weight, 0) / weightSum
        : mean(percents);

  const recent = percents.slice(-recentWindow);
  const prior = percents.slice(0, Math.max(0, percents.length - recentWindow));
  const recentAverage = mean(recent);
  const priorAverage = mean(prior);
  const trendDelta =
    recentAverage !== null && priorAverage !== null ? recentAverage - priorAverage : null;
  const slope = linearSlope(percents);

  // Completion: submitted (on time or late) / work that was expected. Excused work is not expected.
  const expected = ordered.filter((g) => g.status !== 'EXCUSED');
  const completed = expected.filter((g) => g.status === 'SUBMITTED' || g.status === 'LATE');

  // Attendance: late still counts as attended; excused absences are not counted.
  const counted = attendance.filter((s) => s !== 'EXCUSED');
  const attended = counted.filter((s) => s === 'PRESENT' || s === 'LATE');

  const opt = (n: number | null) => (n === null ? null : r1(n));
  return {
    gradedCount: scored.length,
    averagePercent: opt(averagePercent),
    recentAverage: opt(recentAverage),
    priorAverage: opt(priorAverage),
    trendDelta: opt(trendDelta),
    trendSlope: slope === null ? null : Math.round(slope * 100) / 100,
    attendanceSessions: counted.length,
    attendanceRate: counted.length ? r1((attended.length / counted.length) * 100) : null,
    absences: attendance.filter((s) => s === 'ABSENT').length,
    lates: attendance.filter((s) => s === 'LATE').length,
    completionCount: expected.length,
    completionRate: expected.length ? r1((completed.length / expected.length) * 100) : null,
    missingCount: ordered.filter((g) => g.status === 'MISSING').length,
  };
}
