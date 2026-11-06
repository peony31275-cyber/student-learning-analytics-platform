import { z } from 'zod';

/**
 * Configuration of the rule-based early-warning engine.
 *
 * Each rule is "tiered": a metric below `warn` earns `warnPoints`, below
 * `critical` earns `criticalPoints` (decline is measured as a drop, so higher
 * is worse there). Points add up to a 0–100 risk score, which is mapped to a
 * level with two thresholds. Everything is plain arithmetic a teacher can
 * check by hand: this is a transparent scoring rubric, not a predictive model.
 */
const tier = (defaults: {
  warn: number;
  critical: number;
  warnPoints: number;
  criticalPoints: number;
}) =>
  z
    .object({
      enabled: z.boolean().default(true),
      warn: z.number().min(0).max(100).default(defaults.warn),
      critical: z.number().min(0).max(100).default(defaults.critical),
      warnPoints: z.number().int().min(0).max(100).default(defaults.warnPoints),
      criticalPoints: z.number().int().min(0).max(100).default(defaults.criticalPoints),
    })
    .refine((t) => t.criticalPoints >= t.warnPoints, 'criticalPoints must be >= warnPoints');

/** "Below" rules: critical must be the lower (worse) threshold. */
const belowTier = (d: Parameters<typeof tier>[0]) =>
  tier(d).refine((t) => t.critical <= t.warn, 'critical threshold must be <= warn threshold');
/** "Drop" rules: critical must be the larger (worse) drop. */
const dropTier = (d: Parameters<typeof tier>[0]) =>
  tier(d).refine((t) => t.critical >= t.warn, 'critical drop must be >= warn drop');

export const riskConfigSchema = z
  .object({
    /** Score at or above which a student is MEDIUM / HIGH risk. */
    levels: z
      .object({
        medium: z.number().int().min(1).max(100).default(25),
        high: z.number().int().min(1).max(100).default(50),
      })
      .default({ medium: 25, high: 50 })
      .refine((l) => l.medium < l.high, 'medium threshold must be lower than high threshold'),
    /** Number of most recent graded assessments that define "recent performance". */
    recentWindow: z.number().int().min(1).max(10).default(3),
    /** Minimum data points before a rule is evaluated (avoids alarms on one bad quiz). */
    minGradedAssessments: z.number().int().min(1).max(20).default(3),
    minAttendanceSessions: z.number().int().min(1).max(50).default(4),
    rules: z
      .object({
        /** Average % over the most recent `recentWindow` graded assessments. */
        recentPerformance: belowTier({
          warn: 70,
          critical: 60,
          warnPoints: 15,
          criticalPoints: 30,
        }).default({
          enabled: true,
          warn: 70,
          critical: 60,
          warnPoints: 15,
          criticalPoints: 30,
        }),
        /** Drop (percentage points) of the recent average vs. the earlier average. */
        decliningTrend: dropTier({
          warn: 5,
          critical: 10,
          warnPoints: 10,
          criticalPoints: 20,
        }).default({
          enabled: true,
          warn: 5,
          critical: 10,
          warnPoints: 10,
          criticalPoints: 20,
        }),
        /** % of class meetings attended (late counts as attended, excused is not counted). */
        attendance: belowTier({
          warn: 90,
          critical: 80,
          warnPoints: 10,
          criticalPoints: 25,
        }).default({
          enabled: true,
          warn: 90,
          critical: 80,
          warnPoints: 10,
          criticalPoints: 25,
        }),
        /** % of graded work that was submitted (excused is not counted). */
        completion: belowTier({
          warn: 90,
          critical: 75,
          warnPoints: 10,
          criticalPoints: 25,
        }).default({
          enabled: true,
          warn: 90,
          critical: 75,
          warnPoints: 10,
          criticalPoints: 25,
        }),
      })
      .default({
        recentPerformance: {
          enabled: true,
          warn: 70,
          critical: 60,
          warnPoints: 15,
          criticalPoints: 30,
        },
        decliningTrend: {
          enabled: true,
          warn: 5,
          critical: 10,
          warnPoints: 10,
          criticalPoints: 20,
        },
        attendance: { enabled: true, warn: 90, critical: 80, warnPoints: 10, criticalPoints: 25 },
        completion: { enabled: true, warn: 90, critical: 75, warnPoints: 10, criticalPoints: 25 },
      }),
  })
  .strict();

export type RiskConfig = z.infer<typeof riskConfigSchema>;
export type RuleKey = keyof RiskConfig['rules'];

export const DEFAULT_RISK_CONFIG: RiskConfig = riskConfigSchema.parse({});

/**
 * Parses a stored config. Invalid or missing JSON falls back to defaults, so a
 * bad value in the database can never take the engine down.
 */
export function resolveRiskConfig(stored: unknown): RiskConfig {
  const parsed = riskConfigSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : DEFAULT_RISK_CONFIG;
}
