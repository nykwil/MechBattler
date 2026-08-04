import {
  CORE_INSTANCE_ID, connectedInstanceIds, getPart,
  type Build, type ChassisSpec, type PlacedPart,
} from '@mechbattler/sim';
import './PowerPriorityList.css';

function labelFor(instanceId: string, parts: PlacedPart[]): string {
  if (instanceId === CORE_INSTANCE_ID) return 'Locomotion (core)';
  const part = parts.find((p) => p.instanceId === instanceId);
  return part ? getPart(part.partId).name : instanceId;
}

export function PowerPriorityList({
  chassis, build, priority, parts, onMove,
}: {
  chassis: ChassisSpec;
  build: Build;
  priority: string[];
  parts: PlacedPart[];
  onMove: (instanceId: string, direction: -1 | 1) => void;
}) {
  // The same power model the sim scores the build with. This asked the
  // pre-spatial model, which on a regioned chassis -- all three of them -- is a
  // different question, so the lamp could read green on a part the battle then
  // left unpowered.
  const poweredIds = connectedInstanceIds(chassis, build);

  return (
    <div>
      <div className="section-head">
        <span className="eyebrow">Brownout priority</span>
      </div>
      {priority.length === 0 ? (
        <div className="priority-empty">No power-drawing parts placed yet.</div>
      ) : (
        priority.map((id, idx) => {
          const connected = id === CORE_INSTANCE_ID
            ? true // display simplification: core connectivity is checked separately by the sim at runtime
            : poweredIds.has(id);
          return (
            <div className="priority-row" key={id}>
              <span className="priority-rank mono">{idx + 1}</span>
              <span className={`led ${connected ? 'led-green' : 'led-red'}`} />
              <span className="priority-name">{labelFor(id, parts)}</span>
              <div className="priority-btns">
                <button type="button" disabled={idx === 0} onClick={() => onMove(id, -1)} aria-label="Raise priority">↑</button>
                <button type="button" disabled={idx === priority.length - 1} onClick={() => onMove(id, 1)} aria-label="Lower priority">↓</button>
              </div>
            </div>
          );
        })
      )}
      <p className="stat-sub" style={{ marginTop: 8 }}>
        When demand exceeds supply, the bottom of this list sheds first.
      </p>
    </div>
  );
}
