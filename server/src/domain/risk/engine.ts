/**
 * Rule-based early-warning engine (pure function).
 *
 *   evaluateRisk(metrics, config) -> { score, level, factors, skipped }
 *
 * Every point in the score is traceable to a factor with the observed value,
 * the threshold it crossed, and a suggested action. That explainability is
 * the point: a teacher can see *why* a student was flagged and disagree.
 */
import type { RiskConfig, RuleKey } from './config.js';
import type { RiskMetrics } from './metrics.js';

export type Level = 'LOW' | 'MEDIUM' | 'HIGH';
export type Severity = 'WARNING' | 'CRITICAL';

export interface RiskFactor {
  rule: RuleKey;
  severity: Severity;
  points: number;
  value: number;
  threshold: number;
  message: string;
  suggestion: string;
}

export interface RiskEvaluation {
  score: number;
  level: Level;
  factors: RiskFactor[];
  /** Rules not evaluated and why (e.g. not enough data yet). */
  skipped: { rule: RuleKey; reason: string }[];
}

interface RuleDefinition {
  key: RuleKey;
  /** 'below': lower values are worse. 'drop': larger values are worse. */
  direction: 'below' | 'drop';
  /** Returns the observed value, or a reason string when it cannot be evaluated. */
  measure: (m: RiskMetrics, c: RiskConfig) => number | { skip: string };
  message: (value: number, threshold: number, m: RiskMetrics) => string;
  suggestion: (severity: Severity) => string;
}

const fmt = (n: number) => `${Math.round(n * 10) / 10}`;

const RULES: RuleDefinition[] = [
  {
    key: 'recentPerformance',
    direction: 'below',
    measure: (m, c) =>
      m.gradedCount < c.minGradedAssessments || m.recentAverage === null
        ? { skip: `fewer than ${c.minGradedAssessments} graded assessments` }
        : m.recentAverage,
    message: (v, t) => `Recent average is ${fmt(v)}%, below the ${fmt(t)}% threshold`,
    suggestion: (s) =>
      s === 'CRITICAL'
        ? 'Schedule a one-on-one review of recent assessments and arrange tutoring support.'
        : 'Review recent mistakes and attend office hours or a study group.',
  },
  {
    key: 'decliningTrend',
    direction: 'drop',
    measure: (m) =>
      m.trendDelta === null
        ? { skip: 'not enough graded history to compare recent vs. earlier work' }
        : Math.max(0, -m.trendDelta),
    message: (v, _t, m) =>
      `Scores dropped ${fmt(v)} points (recent ${fmt(m.recentAverage ?? 0)}% vs. earlier ${fmt(m.priorAverage ?? 0)}%)`,
    suggestion: (s) =>
      s === 'CRITICAL'
        ? 'Check in early: a sharp decline often has a cause outside the classroom.'
        : 'Identify which recent topics caused the dip and revisit them.',
  },
  {
    key: 'attendance',
    direction: 'below',
    measure: (m, c) =>
      m.attendanceRate === null || m.attendanceSessions < c.minAttendanceSessions
        ? { skip: `fewer than ${c.minAttendanceSessions} recorded class sessions` }
        : m.attendanceRate,
    message: (v, t, m) =>
      `Attendance is ${fmt(v)}% (${m.absences} absences), below the ${fmt(t)}% threshold`,
    suggestion: (s) =>
      s === 'CRITICAL'
        ? 'Contact the student and family about attendance and agree on a plan.'
        : 'Remind the student that regular attendance strongly affects results.',
  },
  {
    key: 'completion',
    direction: 'below',
    measure: (m, c) =>
      m.completionRate === null || m.completionCount < c.minGradedAssessments
        ? { skip: `fewer than ${c.minGradedAssessments} assessments due` }
        : m.completionRate,
    message: (v, t, m) =>
      `Completed ${fmt(v)}% of assigned work (${m.missingCount} missing), below ${fmt(t)}%`,
    suggestion: (s) =>
      s === 'CRITICAL'
        ? 'Set up a catch-up plan with deadlines for the missing work.'
        : 'Use a planner or reminders to stay on top of upcoming deadlines.',
  },
];

export function levelForScore(score: number, levels: RiskConfig['levels']): Level {
  if (score >= levels.high) return 'HIGH';
  if (score >= levels.medium) return 'MEDIUM';
  return 'LOW';
}

export function evaluateRisk(metrics: RiskMetrics, config: RiskConfig): RiskEvaluation {
  const factors: RiskFactor[] = [];
  const skipped: RiskEvaluation['skipped'] = [];

  for (const rule of RULES) {
    const cfg = config.rules[rule.key];
    if (!cfg.enabled) {
      skipped.push({ rule: rule.key, reason: 'rule disabled' });
      continue;
    }
    const value = rule.measure(metrics, config);
    if (typeof value !== 'number') {
      skipped.push({ rule: rule.key, reason: value.skip });
      continue;
    }

    const worse = (threshold: number) =>
      rule.direction === 'below' ? value < threshold : value >= threshold;
    let severity: Severity | null = null;
    if (worse(cfg.critical)) severity = 'CRITICAL';
    else if (worse(cfg.warn)) severity = 'WARNING';
    if (!severity) continue;

    const threshold = severity === 'CRITICAL' ? cfg.critical : cfg.warn;
    const points = severity === 'CRITICAL' ? cfg.criticalPoints : cfg.warnPoints;
    if (points === 0) continue;
    factors.push({
      rule: rule.key,
      severity,
      points,
      value,
      threshold,
      message: rule.message(value, threshold, metrics),
      suggestion: rule.suggestion(severity),
    });
  }

  factors.sort((a, b) => b.points - a.points);
  const score = Math.min(
    100,
    factors.reduce((s, f) => s + f.points, 0),
  );
  return { score, level: levelForScore(score, config.levels), factors, skipped };
}
