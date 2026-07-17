import { useMemo } from 'react';
import {
  computeBurstDps,
  computeCapacitorBank,
  computeEnergyMargin,
  computeHeatBalance,
  computeIdealRangeBand,
  computeSpeedProfile,
  type Build,
  type ChassisSpec,
} from '@mechbattler/sim';
import './StatsPanel.css';

/**
 * Bullet gauge shared by the energy and heat balance bars (docs/01 §9):
 * track = the budget (supply / cooling capacity), fill = the load on it,
 * anything past the capacity tick renders red. Value text stays in ink
 * tokens; the fill color carries the resource identity (blue = energy,
 * amber = heat, everywhere in the app).
 */
function BalanceMeter({
  label, usedKw, capacityKw, theme, headline, headlineCls, sub, preview,
}: {
  label: string;
  usedKw: number;
  capacityKw: number;
  theme: 'energy' | 'heat';
  headline: string;
  headlineCls: 'good' | 'bad' | 'warn' | '';
  sub: string;
  /** Hover preview (docs/01 §9): the bar's state with the hovered part added. */
  preview: { usedKw: number; capacityKw: number } | null;
}) {
  const scaleKw = Math.max(usedKw, capacityKw, preview?.usedKw ?? 0, preview?.capacityKw ?? 0, 0.001) * 1.02;
  const okKw = Math.min(usedKw, capacityKw);
  const overKw = Math.max(0, usedKw - capacityKw);
  const previewMargin = preview ? preview.capacityKw - preview.usedKw : 0;
  return (
    <div className="stat-card wide">
      <div className="meter-head">
        <div className="stat-label" style={{ marginBottom: 0 }}>{label}</div>
        <div className={`meter-value ${headlineCls}`}>
          {preview && (
            <span className={`meter-preview-value ${previewMargin < 0 ? 'bad' : 'good'}`}>
              → {previewMargin >= 0 ? '+' : ''}{previewMargin.toFixed(1)}{' '}
            </span>
          )}
          {headline}
        </div>
      </div>
      <div className="meter-track">
        {preview && preview.usedKw > usedKw && (
          <div className={`meter-fill preview ${theme}`} style={{ width: `${(preview.usedKw / scaleKw) * 100}%` }} />
        )}
        <div className={`meter-fill ${theme}`} style={{ width: `${(okKw / scaleKw) * 100}%` }} />
        {overKw > 0 && (
          <div
            className="meter-fill over"
            style={{ left: `${(okKw / scaleKw) * 100}%`, width: `${(overKw / scaleKw) * 100}%` }}
          />
        )}
        {capacityKw > 0 && <div className="meter-tick" style={{ left: `${(capacityKw / scaleKw) * 100}%` }} />}
        {preview && preview.capacityKw !== capacityKw && (
          <div className="meter-tick preview" style={{ left: `${(preview.capacityKw / scaleKw) * 100}%` }} />
        )}
      </div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

export function StatsPanel({
  chassis, build, hoveredPartId,
}: {
  chassis: ChassisSpec;
  build: Build;
  /** Palette part under the cursor; meters preview its delta (docs/01 §9). */
  hoveredPartId: string | null;
}) {
  const profile = useMemo(() => computeSpeedProfile(chassis, build), [chassis, build]);
  const margin = useMemo(() => computeEnergyMargin(chassis, build), [chassis, build]);
  const heat = useMemo(() => computeHeatBalance(chassis, build), [chassis, build]);
  const caps = useMemo(() => computeCapacitorBank(build), [build]);
  const burst = useMemo(() => computeBurstDps(build), [build]);
  const band = useMemo(() => computeIdealRangeBand(build), [build]);

  // Energy/heat/mass deltas are placement-independent, so the preview build
  // just appends a phantom copy of the hovered part (position irrelevant).
  const previewStats = useMemo(() => {
    if (!hoveredPartId) return null;
    const phantom: Build = {
      ...build,
      parts: [...build.parts, {
        instanceId: '__hover__', partId: hoveredPartId, origin: { x: 0, y: 0 }, rotation: 0, integrity: 1,
      }],
    };
    return {
      margin: computeEnergyMargin(chassis, phantom),
      heat: computeHeatBalance(chassis, phantom),
      profile: computeSpeedProfile(chassis, phantom),
    };
  }, [chassis, build, hoveredPartId]);

  const maxRange = Math.max(band.bandEnd, ...band.perWeapon.map((w) => w.rangeEnd), 50) * 1.15;

  const energySub = (() => {
    const base = `${margin.demandKw.toFixed(1)} kW demand of ${margin.supplyKw.toFixed(0)} kW supply`;
    if (margin.marginKw >= 0 || caps.storedKj <= 0) return base;
    const secs = caps.storedKj / -margin.marginKw;
    return `${base} · full caps buy ~${secs.toFixed(0)}s`;
  })();

  const heatSub = heat.heatInKw <= 0
    ? 'no heat sources'
    : `${heat.heatInKw.toFixed(1)} kW generated of ${heat.coolingKw.toFixed(0)} kW cooling capacity`;

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Live readout</div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Mass</div>
          <div className={`stat-value ${profile.massT > chassis.ratedMassT ? 'warn' : ''}`}>
            {profile.massT.toFixed(2)}t
            {previewStats && (
              <span className={`stat-preview ${previewStats.profile.massT > chassis.ratedMassT ? 'warn' : ''}`}>
                {' '}→ {previewStats.profile.massT.toFixed(2)}t
              </span>
            )}
          </div>
          <div className="stat-sub">rated {chassis.ratedMassT.toFixed(1)}t · load {profile.loadFactor.toFixed(2)}x</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Speed (fwd/strafe/rev)</div>
          <div className="stat-value">{profile.fwd.toFixed(1)} m/s</div>
          <div className="stat-sub">{profile.strafe.toFixed(1)} / {profile.rev.toFixed(1)} m/s · turn {profile.turnRateDegS.toFixed(0)} deg/s</div>
        </div>

        <BalanceMeter
          label="Energy balance"
          usedKw={margin.demandKw}
          capacityKw={margin.supplyKw}
          theme="energy"
          headline={`${margin.marginKw >= 0 ? '+' : ''}${margin.marginKw.toFixed(1)} kW`}
          headlineCls={margin.marginKw < 0 ? 'bad' : 'good'}
          sub={energySub}
          preview={previewStats ? { usedKw: previewStats.margin.demandKw, capacityKw: previewStats.margin.supplyKw } : null}
        />

        <BalanceMeter
          label="Heat balance"
          usedKw={heat.heatInKw}
          capacityKw={heat.coolingKw}
          theme="heat"
          headline={heat.heatInKw <= 0 ? '—' : `${heat.marginKw >= 0 ? '+' : ''}${heat.marginKw.toFixed(1)} kW`}
          headlineCls={heat.heatInKw <= 0 ? '' : heat.marginKw < 0 ? 'bad' : 'good'}
          sub={heatSub}
          preview={previewStats ? { usedKw: previewStats.heat.heatInKw, capacityKw: previewStats.heat.coolingKw } : null}
        />

        <div className="stat-card wide">
          <div className="stat-label">Burst DPS (full capacitors, no heat yet)</div>
          <div className="stat-value">{burst.totalDps.toFixed(1)}</div>
          <div className="stat-sub">
            {burst.perWeapon.length === 0 ? 'no weapons mounted' : burst.perWeapon.map((w) => `${w.partId} ${w.dps.toFixed(1)}`).join(' · ')}
          </div>
        </div>

        <div className="stat-card wide">
          <div className="stat-label">
            Ideal range band {band.mismatched && <span className="warn" style={{ color: 'var(--signal-amber)' }}>· envelopes mismatched</span>}
          </div>
          {band.perWeapon.length === 0 ? (
            <div className="stat-sub">no weapons mounted</div>
          ) : (
            <>
              <div className="stat-value">{band.bandStart.toFixed(0)}–{band.bandEnd.toFixed(0)}m</div>
              <RangeBand band={band} maxRange={maxRange} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RangeBand({
  band, maxRange,
}: {
  band: ReturnType<typeof computeIdealRangeBand>;
  maxRange: number;
}) {
  return (
    <div>
      <div className="range-band">
        {band.perWeapon.map((w) => (
          <div
            key={w.instanceId}
            className="range-band-weapon"
            style={{ left: `${(w.rangeStart / maxRange) * 100}%`, right: `${100 - (w.rangeEnd / maxRange) * 100}%` }}
          />
        ))}
        <div
          className="range-band-fill"
          style={{ left: `${(band.bandStart / maxRange) * 100}%`, right: `${100 - (band.bandEnd / maxRange) * 100}%` }}
        />
      </div>
      <div className="range-band-scale">
        <span>0m</span>
        <span>{maxRange.toFixed(0)}m</span>
      </div>
    </div>
  );
}
