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
  label, usedKw, capacityKw, theme, headline, headlineCls, sub,
}: {
  label: string;
  usedKw: number;
  capacityKw: number;
  theme: 'energy' | 'heat';
  headline: string;
  headlineCls: 'good' | 'bad' | 'warn' | '';
  sub: string;
}) {
  const scaleKw = Math.max(usedKw, capacityKw, 0.001) * 1.02;
  const okKw = Math.min(usedKw, capacityKw);
  const overKw = Math.max(0, usedKw - capacityKw);
  return (
    <div className="stat-card wide">
      <div className="meter-head">
        <div className="stat-label" style={{ marginBottom: 0 }}>{label}</div>
        <div className={`meter-value ${headlineCls}`}>{headline}</div>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${theme}`} style={{ width: `${(okKw / scaleKw) * 100}%` }} />
        {overKw > 0 && (
          <div
            className="meter-fill over"
            style={{ left: `${(okKw / scaleKw) * 100}%`, width: `${(overKw / scaleKw) * 100}%` }}
          />
        )}
        {capacityKw > 0 && <div className="meter-tick" style={{ left: `${(capacityKw / scaleKw) * 100}%` }} />}
      </div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

export function StatsPanel({ chassis, build }: { chassis: ChassisSpec; build: Build }) {
  const profile = useMemo(() => computeSpeedProfile(chassis, build), [chassis, build]);
  const margin = useMemo(() => computeEnergyMargin(chassis, build), [chassis, build]);
  const heat = useMemo(() => computeHeatBalance(chassis, build), [chassis, build]);
  const caps = useMemo(() => computeCapacitorBank(build), [build]);
  const burst = useMemo(() => computeBurstDps(build), [build]);
  const band = useMemo(() => computeIdealRangeBand(build), [build]);

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
        />

        <BalanceMeter
          label="Heat balance"
          usedKw={heat.heatInKw}
          capacityKw={heat.coolingKw}
          theme="heat"
          headline={heat.heatInKw <= 0 ? '—' : `${heat.marginKw >= 0 ? '+' : ''}${heat.marginKw.toFixed(1)} kW`}
          headlineCls={heat.heatInKw <= 0 ? '' : heat.marginKw < 0 ? 'bad' : 'good'}
          sub={heatSub}
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
