import type { RiskAlert } from '../types/api';
import { RULE_LABEL } from '../charts/charts';
import { RiskBadge, fmtDate } from './ui';

/** Explains a risk score: each factor shows the observed value, the threshold and the points it added. */
export function RiskExplanation({
  alert,
  audience = 'staff',
  showHeader = true,
}: {
  alert: RiskAlert;
  audience?: 'staff' | 'student';
  showHeader?: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {showHeader && (
        <div className="row">
          <RiskBadge level={alert.level} score={alert.score} />
          <span className="subtle">
            {alert.course.code} · evaluated {fmtDate(alert.computedAt)}
            {alert.previousLevel &&
              alert.previousLevel !== alert.level &&
              ` · was ${alert.previousLevel.toLowerCase()}`}
          </span>
        </div>
      )}
      {alert.factors.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No risk factors triggered. Keep it up!
        </p>
      ) : (
        alert.factors.map((f) => (
          <div key={f.rule} className={`factor${f.severity === 'CRITICAL' ? ' critical' : ''}`}>
            <div className="factor-head">
              <span>{RULE_LABEL[f.rule] ?? f.rule}</span>
              <span className="subtle num">
                +{f.points} pts · {f.severity === 'CRITICAL' ? 'critical' : 'warning'}
              </span>
            </div>
            <span className="muted">{f.message}</span>
            {audience === 'staff' ? (
              <span className="subtle">Suggested action: {f.suggestion}</span>
            ) : (
              <span className="subtle">Tip: {STUDENT_TIPS[f.rule]}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

const STUDENT_TIPS: Record<string, string> = {
  recentPerformance:
    'Review feedback on your last few assessments and bring questions to office hours.',
  decliningTrend:
    'Your recent scores are lower than earlier in the term; talk to your teacher about what changed.',
  attendance: 'Attending every class is one of the strongest predictors of good results.',
  completion:
    'Ask your teacher whether missing work can still be submitted, and set reminders for deadlines.',
};
