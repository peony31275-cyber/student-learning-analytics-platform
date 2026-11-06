import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_CONFIG, type RiskConfig, resolveRiskConfig, riskConfigSchema } from '../../src/domain/risk/config.js';
import { evaluateRisk, levelForScore } from '../../src/domain/risk/engine.js';
import { type AttendanceStatusLike, type GradePoint, computeMetrics, linearSlope } from '../../src/domain/risk/metrics.js';

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));
const g = (percent: number | null, status: GradePoint['status'] = 'SUBMITTED', i = 0, weight = 1): GradePoint => ({
  percent,
  status,
  weight,
  dueDate: day(i),
});
const series = (...percents: number[]) => percents.map((p, i) => g(p, 'SUBMITTED', i));
const present = (n: number): AttendanceStatusLike[] => Array.from({ length: n }, () => 'PRESENT');
const withConfig = (patch: (c: RiskConfig) => void) => {
  const c = structuredClone(DEFAULT_RISK_CONFIG);
  patch(c);
  return c;
};

describe('computeMetrics', () => {
  it('computes weighted average, recent vs prior averages and trend', () => {
    const m = computeMetrics([g(90, 'SUBMITTED', 0, 1), g(80, 'SUBMITTED', 1, 1), g(70, 'SUBMITTED', 2, 2), g(60, 'SUBMITTED', 3, 1)], [], 2);
    // weighted: (90 + 80 + 140 + 60) / 5 = 74
    expect(m.averagePercent).toBe(74);
    expect(m.recentAverage).toBe(65); // last 2: 70, 60
    expect(m.priorAverage).toBe(85); // 90, 80
    expect(m.trendDelta).toBe(-20);
    expect(m.trendSlope).toBe(-10);
  });

  it('orders grades by due date regardless of input order', () => {
    const m = computeMetrics([g(50, 'SUBMITTED', 3), g(90, 'SUBMITTED', 0), g(80, 'SUBMITTED', 1), g(60, 'SUBMITTED', 2)], [], 2);
    expect(m.recentAverage).toBe(55);
    expect(m.priorAverage).toBe(85);
  });

  it('excludes excused work from completion and unscored work from averages', () => {
    const m = computeMetrics([g(80), g(null, 'MISSING', 1), g(null, 'EXCUSED', 2), g(70, 'LATE', 3)], [], 3);
    expect(m.completionCount).toBe(3);
    expect(m.completionRate).toBe(66.7);
    expect(m.missingCount).toBe(1);
    expect(m.gradedCount).toBe(2);
    expect(m.averagePercent).toBe(75);
  });

  it('counts late as attended and ignores excused sessions', () => {
    const m = computeMetrics([], ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'PRESENT'], 3);
    expect(m.attendanceSessions).toBe(4);
    expect(m.attendanceRate).toBe(75);
    expect(m.absences).toBe(1);
    expect(m.lates).toBe(1);
  });

  it('returns nulls instead of NaN when there is no data', () => {
    const m = computeMetrics([], [], 3);
    expect(m).toMatchObject({ averagePercent: null, recentAverage: null, trendDelta: null, attendanceRate: null, completionRate: null });
  });

  it('linearSlope handles short and flat series', () => {
    expect(linearSlope([])).toBeNull();
    expect(linearSlope([50])).toBeNull();
    expect(linearSlope([70, 70, 70])).toBe(0);
    expect(linearSlope([60, 70, 80])).toBe(10);
  });
});

describe('evaluateRisk', () => {
  const evaluate = (grades: GradePoint[], att: AttendanceStatusLike[], config = DEFAULT_RISK_CONFIG) =>
    evaluateRisk(computeMetrics(grades, att, config.recentWindow), config);

  it('a consistently strong student is LOW risk with no factors', () => {
    const r = evaluate(series(92, 88, 95, 90, 91, 89), present(10));
    expect(r).toMatchObject({ score: 0, level: 'LOW', factors: [] });
  });

  it('flags low recent performance with warning vs critical tiers', () => {
    const warn = evaluate(series(68, 66, 67), present(10));
    expect(warn.factors).toEqual([expect.objectContaining({ rule: 'recentPerformance', severity: 'WARNING', points: 15 })]);

    const critical = evaluate(series(55, 50, 58), present(10));
    expect(critical.factors[0]).toMatchObject({ rule: 'recentPerformance', severity: 'CRITICAL', points: 30, threshold: 60 });
    expect(critical.factors[0]!.message).toContain('54.3%');
  });

  it('uses strict inequality at thresholds (exactly 70% is not a warning)', () => {
    const r = evaluate(series(70, 70, 70), present(10));
    expect(r.factors.find((f) => f.rule === 'recentPerformance')).toBeUndefined();
  });

  it('detects a declining trend from the recent window vs earlier work', () => {
    // earlier avg 90, recent avg 78 → drop of 12 points ≥ critical (10)
    const r = evaluate(series(90, 92, 88, 78, 80, 76), present(10));
    const trend = r.factors.find((f) => f.rule === 'decliningTrend');
    expect(trend).toMatchObject({ severity: 'CRITICAL', points: 20, value: 12 });
    expect(r.level).toBe('LOW'); // 20 points < medium threshold 25: decline alone is a signal, not an alarm
  });

  it('does not treat improvement as a decline', () => {
    const r = evaluate(series(60, 62, 64, 80, 85, 90), present(10));
    expect(r.factors.find((f) => f.rule === 'decliningTrend')).toBeUndefined();
  });

  it('combines factors into MEDIUM and HIGH levels', () => {
    const att: AttendanceStatusLike[] = [...present(7), 'ABSENT', 'ABSENT', 'ABSENT']; // 70%
    const medium = evaluate(series(85, 84, 86, 83, 85, 84), att);
    expect(medium).toMatchObject({ score: 25, level: 'MEDIUM' });

    const grades = [g(70, 'SUBMITTED', 0), g(65, 'SUBMITTED', 1), g(null, 'MISSING', 2), g(50, 'SUBMITTED', 3), g(null, 'MISSING', 4), g(45, 'SUBMITTED', 5)];
    const high = evaluate(grades, att);
    expect(high.level).toBe('HIGH');
    expect(high.factors.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['recentPerformance', 'decliningTrend', 'attendance', 'completion']),
    );
    expect(high.score).toBe(100);
    // Factors are sorted by contribution, biggest first.
    expect(high.factors[0]!.points).toBeGreaterThanOrEqual(high.factors.at(-1)!.points);
  });

  it('caps the score at 100 even with custom point values', () => {
    const config = withConfig((c) => {
      for (const r of Object.values(c.rules)) r.criticalPoints = 60;
    });
    const r = evaluate([g(10), g(null, 'MISSING', 1), g(10, 'SUBMITTED', 2), g(null, 'MISSING', 3)], ['ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'], config);
    expect(r.score).toBe(100);
  });

  it('skips rules with insufficient data instead of raising false alarms', () => {
    const r = evaluate(series(20), ['ABSENT']);
    expect(r.factors).toEqual([]);
    expect(r.skipped.map((s) => s.rule)).toEqual(['recentPerformance', 'decliningTrend', 'attendance', 'completion']);
    expect(r.level).toBe('LOW');
  });

  it('respects disabled rules and custom thresholds', () => {
    const lowAtt: AttendanceStatusLike[] = [...present(5), 'ABSENT', 'ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'];
    const disabled = withConfig((c) => {
      c.rules.attendance.enabled = false;
    });
    expect(evaluate(series(90, 90, 90), lowAtt, disabled).factors).toEqual([]);

    const strict = withConfig((c) => {
      c.rules.recentPerformance.warn = 95;
      c.levels.medium = 10;
    });
    expect(evaluate(series(90, 90, 90), present(10), strict)).toMatchObject({ score: 15, level: 'MEDIUM' });
  });

  it('every factor carries an explanation and a suggestion', () => {
    const r = evaluate([g(40), g(null, 'MISSING', 1), g(45, 'SUBMITTED', 2), g(50, 'SUBMITTED', 3)], [...present(2), 'ABSENT', 'ABSENT']);
    for (const f of r.factors) {
      expect(f.message.length).toBeGreaterThan(10);
      expect(f.suggestion.length).toBeGreaterThan(10);
    }
  });
});

describe('risk configuration', () => {
  it('levelForScore maps scores at the boundaries', () => {
    const levels = { medium: 25, high: 50 };
    expect(levelForScore(24, levels)).toBe('LOW');
    expect(levelForScore(25, levels)).toBe('MEDIUM');
    expect(levelForScore(49, levels)).toBe('MEDIUM');
    expect(levelForScore(50, levels)).toBe('HIGH');
  });

  it('fills defaults for a partial config', () => {
    const c = riskConfigSchema.parse({ rules: { attendance: { warn: 95 } } });
    expect(c.rules.attendance).toMatchObject({ warn: 95, critical: 80, enabled: true });
    expect(c.rules.completion).toEqual(DEFAULT_RISK_CONFIG.rules.completion);
  });

  it('rejects inconsistent thresholds and unknown keys', () => {
    expect(riskConfigSchema.safeParse({ levels: { medium: 60, high: 40 } }).success).toBe(false);
    expect(riskConfigSchema.safeParse({ rules: { attendance: { warn: 70, critical: 90 } } }).success).toBe(false);
    expect(riskConfigSchema.safeParse({ rules: { decliningTrend: { warn: 10, critical: 5 } } }).success).toBe(false);
    expect(riskConfigSchema.safeParse({ unknownSetting: 1 }).success).toBe(false);
  });

  it('falls back to defaults when the stored config is corrupt', () => {
    expect(resolveRiskConfig({ levels: 'nope' })).toEqual(DEFAULT_RISK_CONFIG);
    expect(resolveRiskConfig(null)).toEqual(DEFAULT_RISK_CONFIG);
  });
});
