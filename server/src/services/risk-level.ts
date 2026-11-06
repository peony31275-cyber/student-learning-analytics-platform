import type { RiskLevel } from '../generated/prisma/enums.js';

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** A student's overall risk is the worst risk across their courses. */
export function highestRisk(levels: RiskLevel[]): RiskLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((worst, l) => (RISK_ORDER[l] > RISK_ORDER[worst] ? l : worst));
}

export function levelsAtLeast(min: RiskLevel): RiskLevel[] {
  return (Object.keys(RISK_ORDER) as RiskLevel[]).filter((l) => RISK_ORDER[l] >= RISK_ORDER[min]);
}
