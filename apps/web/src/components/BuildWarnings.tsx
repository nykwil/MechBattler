import type { BuildIssue } from '@mechbattler/sim';
import './BuildWarnings.css';

/**
 * docs/14 §10: an error names the cause and the fix. The sim's message states the
 * cause -- it owns the diagnosis -- so the remedy is added here, keyed on the
 * issue code. Keeping it UI-side means no player-facing prose is duplicated
 * between the two, and the sim's contract is untouched.
 */
const REMEDY: Partial<Record<BuildIssue['code'], string>> = {
  'unpowered-parts': 'Run a Bus between the part and the core.',
  'core-unpowered': 'Run a Bus from a reactor to the core cell.',
  'cap-starved-weapon': 'Add a capacitor to that network, or move the weapon onto one that has power.',
  'cannot-sustain-fire': 'Fit a bigger reactor, drop a draw, or reorder brownout priority.',
  'overheats': 'Add a radiator on the rim, or a heat-pipe route to carry heat out.',
  'part-overheats': 'Move it away from the heat source, or pipe the heat to a radiator.',
  'part-runs-hot': 'A radiator or heat-pipe route nearby will pull the temperature down.',
  'radiator-far': 'Radiators shed heat where they sit — move it nearer what is cooking.',
  'network-starved': 'That network has no reactor reaching it. Run a Bus to one.',
  'overloaded': 'Drop mass, or move up to a chassis rated for it.',
  'no-weapons': 'Mount at least one weapon before fighting.',
  'ammo-cookoff-risk': 'Move the ammo bin away from the heat, or cool the cells around it.',
  'band-mismatch': 'Match the weapons to one engagement band, or accept that some idle.',
};

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
          <span>
            {issue.message}
            {REMEDY[issue.code] && (
              <span className="build-warning-fix">{REMEDY[issue.code]}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
