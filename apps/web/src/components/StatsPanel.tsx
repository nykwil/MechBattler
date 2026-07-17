import { useMemo } from 'react';
import {
  computeBurstDps,
  computeEnergyMargin,
  computeIdealRangeBand,
  computeSpeedProfile,
  type Build,
  type ChassisSpec,
} from '@mechbattler/sim';
import './StatsPanel.css';

export function StatsPanel({ chassis, build }: { chassis: ChassisSpec; build: Build }) {
  const profile = useMemo(() => computeSpeedProfile(chassis, build), [chassis, build]);
  const margin = useMemo(() => computeEnergyMargin(chassis, build), [chassis, build]);
  const burst = useMemo(() => computeBurstDps(build), [build]);
  const band = useMemo(() => computeIdealRangeBand(build), [build]);

  const maxRange = Math.max(band.bandEnd, ...band.perWeapon.map((w) => w.rangeEnd), 50) * 1.15;

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

        <div className="stat-card wide">
          <div className="stat-label">Energy margin (cruise, all weapons max cadence)</div>
          <div className={`stat-value ${margin.marginKw < 0 ? 'bad' : 'good'}`}>
            {margin.marginKw >= 0 ? '+' : ''}{margin.marginKw.toFixed(1)} kW
          </div>
          <div className="stat-sub">{margin.supplyKw.toFixed(0)} kW supply − {margin.demandKw.toFixed(1)} kW demand</div>
        </div>

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
