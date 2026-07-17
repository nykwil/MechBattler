const W = 300;
const H = 70;

export function MiniChart({
  series, maxY, thresholdY,
}: {
  series: { color: string; points: number[] }[];
  maxY: number;
  thresholdY?: number;
}) {
  const n = Math.max(...series.map((s) => s.points.length), 2);
  const toX = (i: number) => (i / (n - 1)) * W;
  const toY = (v: number) => H - Math.min(1, v / maxY) * H;

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <rect x={0} y={0} width={W} height={H} fill="var(--bg-inset)" stroke="var(--line-hairline)" />
      {thresholdY !== undefined && (
        <line x1={0} x2={W} y1={toY(thresholdY)} y2={toY(thresholdY)} stroke="var(--signal-red)" strokeDasharray="3,3" strokeWidth={1} opacity={0.6} />
      )}
      {series.map((s, si) => (
        <polyline
          key={si}
          points={s.points.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')}
          fill="none"
          stroke={s.color}
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
