import { useState, type ReactNode } from 'react';
import { computeSpeedProfile, type Build, type ChassisSpec, type PlacedPart } from '@mechbattler/sim';
import { Sheet } from './Sheet.js';
import { StatsPanel } from './StatsPanel.js';
import { BuildWarnings } from './BuildWarnings.js';
import { PowerPriorityList } from './PowerPriorityList.js';
import { TestBenchPanel } from './TestBenchPanel.js';
import type { TestBenchResult } from '@mechbattler/sim';
import './ReadoutSheet.css';

type Tab = string;

/**
 * Sections that live in the desktop right rail and need a mobile home. They are
 * built once by the caller and handed to whichever container is showing, so the
 * rail and the sheet can never drift apart (docs/14 §11).
 */
export interface ExtraTab {
  id: string;
  label: string;
  node: ReactNode;
}

/**
 * What the readout bar opens (docs/14 §8). Its tabs are also where the §14
 * right-rail audit puts the items that must not be lost on mobile: the speed
 * envelope, the fault list behind the bar's count, and power priority.
 */
export function ReadoutSheet({
  open, onClose, chassis, build, parts, powerPriority, issues, onMovePriority, onBenchResult,
  onAutoWire, extraTabs = [], initialTab,
}: {
  open: boolean;
  onClose: () => void;
  chassis: ChassisSpec;
  build: Build;
  parts: PlacedPart[];
  powerPriority: string[];
  issues: Parameters<typeof BuildWarnings>[0]['issues'];
  onMovePriority: (instanceId: string, direction: -1 | 1) => void;
  onBenchResult: (result: TestBenchResult | null) => void;
  /** Lays a functional conduit graph; the fix for most unpowered-part faults. */
  onAutoWire?: () => void;
  extraTabs?: ExtraTab[];
  /**
   * Which tab to open on. The run's memorial lives in the run tab, and the front
   * door's "View the memorial" used to land on vitals -- a button that did not do
   * what it said, with the thing it named three taps further in.
   */
  initialTab?: string;
}) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'vitals');
  const profile = computeSpeedProfile(chassis, build);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'vitals', label: 'vitals' },
    { id: 'faults', label: `Faults (${issues.length})` },
    { id: 'power', label: 'power' },
    { id: 'bench', label: 'bench' },
    ...extraTabs.map((t) => ({ id: t.id, label: t.label })),
  ];

  return (
    <Sheet open={open} onClose={onClose} label="Build readout">
      <div className="readout-tabs" role="tablist" aria-label="Readout section">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`readout-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'vitals' && (
        <>
          {/*
            The speed envelope is an ellipse, not a scalar: combat.ts derives max
            speed per heading from all three figures, and dispersion is
            speed-gated, so this is combat-relevant rather than trivia. Four
            values do not fit the 56px bar, so they live here (docs/14 §14).
          */}
          <div className="readout-speed">
            <span className="readout-speed-label">Speed envelope</span>
            <dl className="readout-speed-grid">
              <div><dt>Forward</dt><dd>{profile.fwd.toFixed(1)} m/s</dd></div>
              <div><dt>Strafe</dt><dd>{profile.strafe.toFixed(1)} m/s</dd></div>
              <div><dt>Reverse</dt><dd>{profile.rev.toFixed(1)} m/s</dd></div>
              <div><dt>Turn</dt><dd>{profile.turnRateDegS.toFixed(0)} deg/s</dd></div>
            </dl>
          </div>
          <StatsPanel chassis={chassis} build={build} hoveredPartId={null} />
        </>
      )}

      {tab === 'faults' && (
        <>
          {/* The prototype's idle action bar is the intel strip, so auto-wire
              lives beside the faults it exists to clear rather than competing
              for a slot the prototype spends on the coming fight. */}
          {onAutoWire && (
            <button type="button" className="btn" onClick={onAutoWire} style={{ marginBottom: 'var(--space-3)' }}>
              Auto-wire unpowered parts
            </button>
          )}
          {issues.length === 0
            ? <p className="readout-empty">No faults on this build.</p>
            : <BuildWarnings issues={issues} />}
        </>
      )}

      {/* The only control for brownout order anywhere in the app (docs/14 §14).
          It already reorders with up/down buttons rather than drag, which is
          what touch needs. */}
      {tab === 'power' && (
        <PowerPriorityList priority={powerPriority} parts={parts} onMove={onMovePriority} />
      )}

      {tab === 'bench' && (
        <TestBenchPanel chassis={chassis} build={build} onResult={onBenchResult} />
      )}

      {extraTabs.filter((t) => t.id === tab).map((t) => (
        <div key={t.id}>{t.node}</div>
      ))}
    </Sheet>
  );
}
