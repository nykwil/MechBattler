import type { BuildIssue } from '@mechbattler/sim';
import './BuildWarnings.css';

/**
 * The loud warning surface (docs/02 §2): errors are physical impossibilities
 * (the part will not function), warnings are legal-but-consequential states.
 * Renders nothing when the build is clean — silence means airworthy.
 */
export function BuildWarnings({ issues }: { issues: BuildIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="build-warnings">
      {issues.map((issue, i) => (
        <div key={i} className={`build-warning ${issue.severity}`}>
          <span className="build-warning-badge">
            {issue.severity === 'error' ? 'FAULT' : issue.severity === 'warn' ? 'WARN' : 'HINT'}
          </span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}
