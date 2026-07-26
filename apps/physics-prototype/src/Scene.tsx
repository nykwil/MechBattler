import { Line } from '@react-three/drei/core/Line.js';
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
import { Canvas, type ThreeEvent, useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
  useBeforePhysicsStep,
  useRapier,
} from '@react-three/rapier';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import {
  Color,
  Group,
  MathUtils,
  Mesh,
  MOUSE,
  Quaternion,
  Vector3,
} from 'three';
import { horizontalDistance, nextStepGroup, stepArc } from './gait.js';
import type { PhysicalMechDescription, PhysicalPart } from './model.js';

export interface SceneCommand {
  destination: [number, number] | null;
  faceTarget: [number, number];
  faceTargetEnabled: boolean;
}

export interface PrototypeTelemetry {
  speedMps: number;
  tiltDeg: number;
  support: 'stable' | 'stepping' | 'fallen';
  gaitPhase: string;
  distanceM: number;
  position: [number, number, number];
}

export interface DebugOptions {
  physics: boolean;
  centerOfMass: boolean;
  supportPolygon: boolean;
  footTargets: boolean;
  forces: boolean;
}

interface FootRuntime {
  planted: Vector3;
  from: Vector3;
  to: Vector3;
  visual: Vector3;
  desired: Vector3;
  progress: number;
  swinging: boolean;
  supportForce: number;
}

interface LegVisualRuntime {
  hip: Vector3;
  knee: Vector3;
  foot: Vector3;
  desired: Vector3;
  swinging: boolean;
  supportForce: number;
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const BODY_COLOR = '#77806f';
const BODY_DARK = '#252b29';
const SAFETY_ORANGE = '#ffb347';
const TARGET_CYAN = '#62e2d5';

function clampMagnitude(vector: Vector3, max: number): Vector3 {
  if (vector.length() > max) vector.setLength(max);
  return vector;
}

function angleDelta(target: number, current: number): number {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function updateSegment(mesh: Mesh, start: Vector3, end: Vector3, thickness: number) {
  const delta = end.clone().sub(start);
  const length = Math.max(0.001, delta.length());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
  mesh.scale.set(thickness, length, thickness);
}

function categoryColor(part: PhysicalPart): string {
  if (part.stressOnly) return '#d36a36';
  switch (part.category) {
    case 'weapon': return '#6c756d';
    case 'reactor': return '#b86838';
    case 'capacitor': return '#3e7d82';
    case 'utility': return '#9a8e69';
    case 'structural': return '#555d58';
  }
}

function JunkPart({ part }: { part: PhysicalPart }) {
  const [width, height, depth] = part.localSizeM;
  const isWeapon = part.category === 'weapon';
  return (
    <group position={part.localPositionM}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={categoryColor(part)}
          roughness={0.68}
          metalness={0.52}
        />
      </mesh>
      <mesh position={[0, height * 0.52, -depth * 0.18]} castShadow>
        <boxGeometry args={[Math.max(0.12, width * 0.72), 0.08, Math.max(0.16, depth * 0.42)]} />
        <meshStandardMaterial color={BODY_DARK} roughness={0.8} metalness={0.3} />
      </mesh>
      {isWeapon && (
        <>
          <mesh position={[0, 0.02, depth * 0.58]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[Math.max(0.06, width * 0.1), Math.max(0.08, width * 0.14), depth * 0.48, 10]} />
            <meshStandardMaterial color="#222826" metalness={0.78} roughness={0.36} />
          </mesh>
          <mesh position={[0, 0.02, depth * 0.83]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[Math.max(0.09, width * 0.15), Math.max(0.09, width * 0.15), 0.14, 10]} />
            <meshStandardMaterial color={part.stressOnly ? SAFETY_ORANGE : '#363d39'} metalness={0.72} roughness={0.42} />
          </mesh>
        </>
      )}
      {part.category === 'reactor' && (
        <mesh position={[0, height * 0.38, 0]}>
          <boxGeometry args={[width * 0.54, height * 0.32, depth * 0.62]} />
          <meshStandardMaterial color="#d78645" emissive="#8a2f14" emissiveIntensity={0.45} />
        </mesh>
      )}
    </group>
  );
}

function LegVisual({
  index,
  runtime,
  debug,
}: {
  index: number;
  runtime: React.MutableRefObject<LegVisualRuntime[]>;
  debug: DebugOptions;
}) {
  const upper = useRef<Mesh>(null);
  const lower = useRef<Mesh>(null);
  const foot = useRef<Mesh>(null);
  const target = useRef<Mesh>(null);
  const force = useRef<Mesh>(null);

  useFrame(() => {
    const leg = runtime.current[index];
    if (!leg || !upper.current || !lower.current || !foot.current || !target.current || !force.current) return;
    updateSegment(upper.current, leg.hip, leg.knee, 0.095);
    updateSegment(lower.current, leg.knee, leg.foot, 0.075);
    foot.current.position.copy(leg.foot).addScaledVector(UP, 0.06);
    foot.current.rotation.y = index % 2 === 0 ? -0.08 : 0.08;
    target.current.position.copy(leg.desired).addScaledVector(UP, 0.025);
    target.current.visible = debug.footTargets;
    force.current.position.copy(leg.foot).addScaledVector(UP, Math.max(0.02, leg.supportForce * 0.015));
    force.current.scale.set(1, Math.max(0.04, leg.supportForce * 0.03), 1);
    force.current.visible = debug.forces && !leg.swinging;
  });

  return (
    <>
      <mesh ref={upper} castShadow>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color={index % 2 === 0 ? '#4f5a54' : '#59635c'} metalness={0.62} roughness={0.46} />
      </mesh>
      <mesh ref={lower} castShadow>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color={BODY_DARK} metalness={0.58} roughness={0.5} />
      </mesh>
      <mesh ref={foot} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.12, 0.58]} />
        <meshStandardMaterial color="#303734" metalness={0.42} roughness={0.78} />
      </mesh>
      <mesh ref={target}>
        <ringGeometry args={[0.12, 0.18, 16]} />
        <meshBasicMaterial color={TARGET_CYAN} depthTest={false} />
      </mesh>
      <mesh ref={force}>
        <cylinderGeometry args={[0.025, 0.055, 1, 7]} />
        <meshBasicMaterial color="#69e78e" transparent opacity={0.72} depthTest={false} />
      </mesh>
    </>
  );
}

function SupportDebug({
  runtime,
  gait,
  visible,
}: {
  runtime: React.MutableRefObject<LegVisualRuntime[]>;
  gait: 'biped' | 'quad';
  visible: boolean;
}) {
  const order = gait === 'biped' ? [[0, 1]] : [[0, 1], [1, 3], [3, 2], [2, 0]];
  const refs = useRef<Array<Mesh | null>>([]);
  useFrame(() => {
    order.forEach(([a, b], index) => {
      const mesh = refs.current[index];
      const start = runtime.current[a!]?.foot;
      const end = runtime.current[b!]?.foot;
      if (!mesh || !start || !end) return;
      updateSegment(mesh, start.clone().addScaledVector(UP, 0.035), end.clone().addScaledVector(UP, 0.035), 0.018);
      mesh.visible = visible;
    });
  });
  return (
    <>
      {order.map((_, index) => (
        <mesh key={index} ref={(mesh) => { refs.current[index] = mesh; }}>
          <cylinderGeometry args={[1, 1, 1, 6]} />
          <meshBasicMaterial color={SAFETY_ORANGE} depthTest={false} transparent opacity={0.9} />
        </mesh>
      ))}
    </>
  );
}

function PhysicalMech({
  mech,
  command,
  debug,
  fireToken,
  onTelemetry,
}: {
  mech: PhysicalMechDescription;
  command: SceneCommand;
  debug: DebugOptions;
  fireToken: number;
  onTelemetry: (telemetry: PrototypeTelemetry) => void;
}) {
  const body = useRef<RapierRigidBody>(null);
  const { world, rapier } = useRapier();
  const spawnY = mech.legRig.upperLengthM + mech.legRig.lowerLengthM - 0.12 + mech.bodySizeM[1] / 2;
  const feet = useRef<FootRuntime[]>(mech.legRig.neutralFeetM.map((neutral) => {
    const planted = new Vector3(neutral[0], 0.06, neutral[2]);
    return {
      planted,
      from: planted.clone(),
      to: planted.clone(),
      visual: planted.clone(),
      desired: planted.clone(),
      progress: 1,
      swinging: false,
      supportForce: 0,
    };
  }));
  const legVisuals = useRef<LegVisualRuntime[]>(feet.current.map((foot) => ({
    hip: new Vector3(),
    knee: new Vector3(),
    foot: foot.visual,
    desired: foot.desired,
    swinging: false,
    supportForce: 0,
  })));
  const activeGroup = useRef(0);
  const stepCooldown = useRef(0);
  const fallen = useRef(false);
  const lastTelemetry = useRef(0);
  const muzzleUntil = useRef(0);
  const muzzle = useRef<Mesh>(null);
  const comMarker = useRef<Group>(null);
  const chosenWeapon = useMemo(
    () => [...mech.parts].filter((part) => (part.recoilKnS ?? 0) > 0).sort((a, b) => (b.recoilKnS ?? 0) - (a.recoilKnS ?? 0))[0],
    [mech.parts],
  );

  useEffect(() => {
    if (fireToken === 0 || !body.current || !chosenWeapon?.recoilKnS) return;
    const rotation = body.current.rotation();
    const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const backward = FORWARD.clone().applyQuaternion(quaternion).multiplyScalar(-chosenWeapon.recoilKnS);
    const mount = new Vector3(...chosenWeapon.localPositionM).applyQuaternion(quaternion);
    const translation = body.current.translation();
    mount.add(new Vector3(translation.x, translation.y, translation.z));
    body.current.applyImpulseAtPoint({ x: backward.x, y: backward.y, z: backward.z }, mount, true);
    muzzleUntil.current = performance.now() + 120;
  }, [chosenWeapon, fireToken]);

  useBeforePhysicsStep(() => {
    const rigid = body.current;
    if (!rigid) return;
    // Rapier's user forces persist until explicitly cleared. Rebuild the
    // controller's force/torque request every fixed step so suspension and
    // steering do not accumulate into an unbounded launch.
    rigid.resetForces(false);
    rigid.resetTorques(false);
    const dt = 1 / 60;
    const translation = rigid.translation();
    const rotation = rigid.rotation();
    const velocity = rigid.linvel();
    const angularVelocity = rigid.angvel();
    const position = new Vector3(translation.x, translation.y, translation.z);
    const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const up = UP.clone().applyQuaternion(quaternion);
    const forward = FORWARD.clone().applyQuaternion(quaternion);
    const tilt = Math.acos(MathUtils.clamp(up.dot(UP), -1, 1));
    if (tilt > MathUtils.degToRad(35) || translation.y < 0.72) fallen.current = true;

    const horizontalVelocity = new Vector3(velocity.x, 0, velocity.z);
    const velocityLimit = mech.locomotion.maxSpeedMps * (fallen.current ? 1.25 : 1.6);
    if (horizontalVelocity.length() > velocityLimit) {
      horizontalVelocity.setLength(velocityLimit);
      rigid.setLinvel({ x: horizontalVelocity.x, y: velocity.y, z: horizontalVelocity.z }, true);
      velocity.x = horizontalVelocity.x;
      velocity.z = horizontalVelocity.z;
    }

    const desiredFeet = mech.legRig.neutralFeetM.map((neutral) => {
      const local = new Vector3(neutral[0], 0, neutral[2]).applyQuaternion(quaternion);
      const lead = new Vector3(velocity.x, 0, velocity.z).multiplyScalar(mech.legRig.gait === 'biped' ? 0.18 : 0.13);
      return position.clone().add(local).add(lead);
    });

    for (let index = 0; index < desiredFeet.length; index++) {
      const desired = desiredFeet[index]!;
      const ray = new rapier.Ray({ x: desired.x, y: 4.5, z: desired.z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 8, true, undefined, undefined, undefined, rigid);
      desired.y = hit ? 4.5 - hit.timeOfImpact + 0.055 : 0.055;
      feet.current[index]!.desired.copy(desired);
    }

    stepCooldown.current = Math.max(0, stepCooldown.current - dt);
    const group = nextStepGroup(mech.legRig.gait, activeGroup.current);
    const anySwinging = feet.current.some((foot) => foot.swinging);
    const groupError = Math.max(...group.map((index) => horizontalDistance(
      [feet.current[index]!.planted.x, 0, feet.current[index]!.planted.z],
      [feet.current[index]!.desired.x, 0, feet.current[index]!.desired.z],
    )));
    const speed = Math.hypot(velocity.x, velocity.z);
    const stepThreshold = mech.legRig.gait === 'biped' ? 0.46 : 0.4;
    if (!fallen.current && !anySwinging && stepCooldown.current <= 0 && groupError > stepThreshold && (speed > 0.08 || groupError > 0.72)) {
      for (const index of group) {
        const foot = feet.current[index]!;
        foot.swinging = true;
        foot.progress = 0;
        foot.from.copy(foot.visual);
        foot.to.copy(foot.desired);
      }
    }

    let completedGroup = false;
    for (const foot of feet.current) {
      if (foot.swinging) {
        foot.progress = Math.min(1, foot.progress + dt / mech.legRig.stepDurationS);
        const arc = stepArc(
          [foot.from.x, foot.from.y, foot.from.z],
          [foot.to.x, foot.to.y, foot.to.z],
          foot.progress,
          mech.legRig.stepHeightM,
        );
        foot.visual.set(...arc);
        if (foot.progress >= 1) {
          foot.swinging = false;
          foot.planted.copy(foot.to);
          foot.visual.copy(foot.to);
          completedGroup = true;
        }
      } else {
        foot.visual.copy(foot.planted);
      }
    }
    if (completedGroup && !feet.current.some((foot) => foot.swinging)) {
      activeGroup.current = (activeGroup.current + 1) % 2;
      stepCooldown.current = 0.06;
    }

    const planted = feet.current.filter((foot) => !foot.swinging);
    if (!fallen.current && planted.length > 0) {
      const averageGround = planted.reduce((sum, foot) => sum + foot.planted.y, 0) / planted.length;
      const targetBodyY = averageGround + (mech.legRig.upperLengthM + mech.legRig.lowerLengthM) * 0.88 + mech.bodySizeM[1] / 2;
      const mass = rigid.mass();
      const heightError = targetBodyY - translation.y;
      const requestedSupport = mass * (9.81 + heightError * 16 - velocity.y * 4.8);
      const actuatorLimit = mech.ratedMassT * 9.81 * (mech.legRig.gait === 'quad' ? 1.55 : 1.24);
      const totalSupport = MathUtils.clamp(requestedSupport, 0, actuatorLimit);
      const perFoot = totalSupport / planted.length;
      for (const foot of feet.current) {
        foot.supportForce = foot.swinging ? 0 : perFoot;
        if (!foot.swinging) {
          rigid.addForceAtPoint(
            { x: 0, y: perFoot, z: 0 },
            { x: foot.planted.x, y: foot.planted.y, z: foot.planted.z },
            true,
          );
        }
      }

      const toDestination = command.destination
        ? new Vector3(command.destination[0] - translation.x, 0, command.destination[1] - translation.z)
        : new Vector3();
      const distance = toDestination.length();
      const moveDirection = distance > 0.18 ? toDestination.normalize() : new Vector3();
      const desiredSpeed = Math.min(mech.locomotion.maxSpeedMps, Math.max(0, distance - 0.12) * 1.15);
      const desiredVelocity = moveDirection.multiplyScalar(desiredSpeed);
      const velocityError = desiredVelocity.sub(new Vector3(velocity.x, 0, velocity.z));
      const locomotionForce = clampMagnitude(
        velocityError.multiplyScalar(mech.ratedMassT * 2.8),
        mech.ratedMassT * mech.locomotion.accelMps2,
      );
      rigid.addForce({ x: locomotionForce.x, y: 0, z: locomotionForce.z }, true);

      let desiredYaw: number | null = null;
      if (command.faceTargetEnabled) {
        desiredYaw = Math.atan2(command.faceTarget[0] - translation.x, command.faceTarget[1] - translation.z);
      } else if (distance > 0.18) {
        desiredYaw = Math.atan2(toDestination.x, toDestination.z);
      }
      const currentYaw = Math.atan2(forward.x, forward.z);
      const uprightAxis = up.clone().cross(UP);
      const assistScale = MathUtils.clamp(mech.ratedMassT / Math.max(mech.totalMassT, 0.1), 0.38, 1);
      const torque = uprightAxis.multiplyScalar(mech.ratedMassT * 24 * assistScale);
      torque.x -= angularVelocity.x * mech.ratedMassT * 5.5;
      torque.z -= angularVelocity.z * mech.ratedMassT * 5.5;
      if (desiredYaw !== null) {
        const yawError = angleDelta(desiredYaw, currentYaw);
        const maxYaw = MathUtils.degToRad(mech.locomotion.turnRateDegS);
        torque.y = MathUtils.clamp(yawError * mech.ratedMassT * 8 - angularVelocity.y * mech.ratedMassT * 2.2, -maxYaw * mech.ratedMassT, maxYaw * mech.ratedMassT);
      } else {
        torque.y = -angularVelocity.y * mech.ratedMassT * 1.8;
      }
      rigid.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);
    } else {
      for (const foot of feet.current) foot.supportForce = 0;
    }

    const bendBase = new Vector3(0, 0, 1).applyQuaternion(quaternion);
    for (let index = 0; index < feet.current.length; index++) {
      const hipLocal = new Vector3(...mech.legRig.hipOffsetsM[index]!);
      const hip = hipLocal.applyQuaternion(quaternion).add(position);
      const foot = feet.current[index]!.visual;
      const toFoot = foot.clone().sub(hip);
      const distance = Math.max(0.05, Math.min(
        toFoot.length(),
        mech.legRig.upperLengthM + mech.legRig.lowerLengthM - 0.015,
      ));
      const direction = toFoot.normalize();
      const along = (
        mech.legRig.upperLengthM ** 2
        + distance ** 2
        - mech.legRig.lowerLengthM ** 2
      ) / (2 * distance);
      const bendAmount = Math.sqrt(Math.max(0, mech.legRig.upperLengthM ** 2 - along ** 2));
      const outward = new Vector3(Math.sign(mech.legRig.hipOffsetsM[index]![0]) || 1, 0, 0)
        .applyQuaternion(quaternion)
        .multiplyScalar(mech.legRig.gait === 'quad' ? 0.75 : 0.28)
        .addScaledVector(bendBase, mech.legRig.gait === 'biped' ? 0.82 : 0.35)
        .normalize();
      const perpendicular = outward.sub(direction.clone().multiplyScalar(outward.dot(direction))).normalize();
      const knee = hip.clone().addScaledVector(direction, along).addScaledVector(perpendicular, bendAmount);
      const visual = legVisuals.current[index]!;
      visual.hip.copy(hip);
      visual.knee.copy(knee);
      visual.foot.copy(foot);
      visual.desired.copy(feet.current[index]!.desired);
      visual.swinging = feet.current[index]!.swinging;
      visual.supportForce = feet.current[index]!.supportForce;
    }

    const now = performance.now();
    if (now - lastTelemetry.current > 100) {
      lastTelemetry.current = now;
      const distance = command.destination
        ? Math.hypot(command.destination[0] - translation.x, command.destination[1] - translation.z)
        : 0;
      onTelemetry({
        speedMps: Math.hypot(velocity.x, velocity.z),
        tiltDeg: MathUtils.radToDeg(tilt),
        support: fallen.current ? 'fallen' : feet.current.some((foot) => foot.swinging) ? 'stepping' : 'stable',
        gaitPhase: fallen.current ? 'controller released' : `${mech.legRig.gait} · group ${activeGroup.current + 1}`,
        distanceM: distance,
        position: [translation.x, translation.y, translation.z],
      });
    }
  });

  useFrame(() => {
    const rigid = body.current;
    if (!rigid) return;
    const rotation = rigid.rotation();
    const translation = rigid.translation();
    const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    if (comMarker.current) {
      const com = new Vector3(...mech.centerOfMassLocalM).applyQuaternion(quaternion);
      comMarker.current.position.set(translation.x + com.x, translation.y + com.y, translation.z + com.z);
      comMarker.current.visible = debug.centerOfMass;
    }
    if (muzzle.current && chosenWeapon) {
      const local = new Vector3(...chosenWeapon.localPositionM);
      local.z += chosenWeapon.localSizeM[2] * 0.66;
      local.applyQuaternion(quaternion);
      muzzle.current.position.set(translation.x + local.x, translation.y + local.y, translation.z + local.z);
      muzzle.current.quaternion.copy(quaternion);
      muzzle.current.visible = performance.now() < muzzleUntil.current;
      if (muzzle.current.visible) {
        const pulse = 0.65 + Math.random() * 0.35;
        muzzle.current.scale.setScalar(pulse);
      }
    }
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        position={[0, spawnY, 0]}
        linearDamping={0.32}
        angularDamping={0.5}
        canSleep={false}
        ccd
      >
        <CuboidCollider
          args={[mech.bodySizeM[0] / 2, mech.bodySizeM[1] / 2, mech.bodySizeM[2] / 2]}
          mass={mech.structuralMassT}
          friction={0.8}
        />
        {mech.parts.map((part) => (
          <CuboidCollider
            key={part.instanceId}
            args={[part.localSizeM[0] / 2, part.localSizeM[1] / 2, part.localSizeM[2] / 2]}
            position={part.localPositionM}
            mass={part.massT}
            friction={0.74}
          />
        ))}
        <group>
          <mesh castShadow receiveShadow>
            <boxGeometry args={mech.bodySizeM} />
            <meshStandardMaterial color={BODY_COLOR} roughness={0.66} metalness={0.48} />
          </mesh>
          <mesh position={[0, 0.1, mech.bodySizeM[2] * 0.49]} castShadow>
            <boxGeometry args={[mech.bodySizeM[0] * 0.5, mech.bodySizeM[1] * 0.45, 0.12]} />
            <meshStandardMaterial color={SAFETY_ORANGE} roughness={0.7} metalness={0.35} />
          </mesh>
          <mesh position={[0, -mech.bodySizeM[1] * 0.48, 0]}>
            <boxGeometry args={[mech.bodySizeM[0] * 0.56, 0.16, mech.bodySizeM[2] * 0.54]} />
            <meshStandardMaterial color={BODY_DARK} roughness={0.8} metalness={0.38} />
          </mesh>
          {mech.parts.map((part) => <JunkPart key={part.instanceId} part={part} />)}
        </group>
      </RigidBody>
      {mech.legRig.hipOffsetsM.map((_, index) => (
        <LegVisual key={index} index={index} runtime={legVisuals} debug={debug} />
      ))}
      <SupportDebug runtime={legVisuals} gait={mech.legRig.gait} visible={debug.supportPolygon} />
      <group ref={comMarker}>
        <mesh>
          <sphereGeometry args={[0.13, 14, 10]} />
          <meshBasicMaterial color="#ff4778" depthTest={false} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.22, 0.025, 8, 20]} />
          <meshBasicMaterial color="#ff4778" depthTest={false} />
        </mesh>
      </group>
      <mesh ref={muzzle} visible={false}>
        <coneGeometry args={[0.28, 0.8, 8]} />
        <meshBasicMaterial color="#ffd36d" transparent opacity={0.88} />
      </mesh>
    </>
  );
}

function TargetMarker({ point, active }: { point: [number, number]; active: boolean }) {
  return (
    <group position={[point[0], 0.08, point[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.44, 28]} />
        <meshBasicMaterial color={active ? TARGET_CYAN : '#71837e'} transparent opacity={active ? 0.95 : 0.55} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.025, 0.06, 1.0, 8]} />
        <meshBasicMaterial color={active ? TARGET_CYAN : '#71837e'} />
      </mesh>
      <mesh position={[0, 1.07, 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.13, 0.32, 8]} />
        <meshBasicMaterial color={active ? TARGET_CYAN : '#71837e'} />
      </mesh>
    </group>
  );
}

function DestinationMarker({ point }: { point: [number, number] | null }) {
  if (!point) return null;
  return (
    <group position={[point[0], 0.045, point[1]]}>
      <Line points={[[-0.35, 0, 0], [0.35, 0, 0]]} color={SAFETY_ORANGE} lineWidth={2} />
      <Line points={[[0, 0, -0.35], [0, 0, 0.35]]} color={SAFETY_ORANGE} lineWidth={2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.48, 0.53, 28]} />
        <meshBasicMaterial color={SAFETY_ORANGE} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function Arena({ onGround }: { onGround: (point: [number, number], faceTarget: boolean) => void }) {
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.button !== 0 || event.delta > 4) return;
    event.stopPropagation();
    onGround([MathUtils.clamp(event.point.x, -11, 11), MathUtils.clamp(event.point.z, -11, 11)], event.nativeEvent.shiftKey);
  };
  return (
    <>
      <RigidBody type="fixed" colliders="cuboid" position={[0, -0.25, 0]}>
        <mesh receiveShadow onClick={click}>
          <boxGeometry args={[24, 0.5, 24]} />
          <meshStandardMaterial color="#323834" roughness={0.94} metalness={0.04} />
        </mesh>
      </RigidBody>
      <gridHelper args={[24, 24, new Color('#5a655f'), new Color('#3e4742')]} position={[0, 0.012, 0]} />
      <RigidBody type="fixed" colliders="cuboid" position={[-5.2, 0.52, -0.4]} rotation={[0.11, 0, 0]}>
        <mesh castShadow receiveShadow onClick={click}>
          <boxGeometry args={[3.5, 0.42, 5.2]} />
          <meshStandardMaterial color="#565b50" roughness={0.9} metalness={0.1} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders="cuboid" position={[4.7, 0.38, 2.5]}>
        <mesh castShadow receiveShadow onClick={click}>
          <boxGeometry args={[3.2, 0.76, 2.7]} />
          <meshStandardMaterial color="#4a514d" roughness={0.86} metalness={0.18} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders="cuboid" position={[2.4, 0.18, -4.6]}>
        <mesh castShadow receiveShadow onClick={click}>
          <boxGeometry args={[2.4, 0.36, 2.4]} />
          <meshStandardMaterial color="#696551" roughness={0.95} metalness={0.05} />
        </mesh>
      </RigidBody>
      {[
        [-11.75, 0.65, 0, 0.5, 1.3, 24],
        [11.75, 0.65, 0, 0.5, 1.3, 24],
        [0, 0.65, 11.75, 24, 1.3, 0.5],
        [0, 0.65, -11.75, 24, 1.3, 0.5],
      ].map(([x, y, z, sx, sy, sz], index) => (
        <RigidBody key={index} type="fixed" colliders="cuboid" position={[x!, y!, z!]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[sx!, sy!, sz!]} />
            <meshStandardMaterial color="#49504c" roughness={0.72} metalness={0.34} />
          </mesh>
        </RigidBody>
      ))}
      <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={click}>
        <planeGeometry args={[23.6, 23.6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

function SceneContents({
  mech,
  command,
  debug,
  fireToken,
  onGround,
  onTelemetry,
}: {
  mech: PhysicalMechDescription;
  command: SceneCommand;
  debug: DebugOptions;
  fireToken: number;
  onGround: (point: [number, number], faceTarget: boolean) => void;
  onTelemetry: (telemetry: PrototypeTelemetry) => void;
}) {
  return (
    <>
      <color attach="background" args={['#151a18']} />
      <fog attach="fog" args={['#151a18', 16, 38]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={['#b8d1c5', '#25251f', 1.1]} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={2.4}
        color="#ffe5bd"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={40}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <pointLight position={[-8, 2.5, -7]} intensity={18} distance={9} color="#c46735" />
      <Arena onGround={onGround} />
      <TargetMarker point={command.faceTarget} active={command.faceTargetEnabled} />
      <DestinationMarker point={command.destination} />
      <PhysicalMech
        mech={mech}
        command={command}
        debug={debug}
        fireToken={fireToken}
        onTelemetry={onTelemetry}
      />
      <OrbitControls
        makeDefault
        target={[0, 1.1, 0]}
        minDistance={6}
        maxDistance={26}
        maxPolarAngle={Math.PI * 0.47}
        enablePan={false}
        mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
      />
    </>
  );
}

export function PrototypeCanvas({
  mech,
  command,
  debug,
  paused,
  slowMotion,
  fireToken,
  resetToken,
  onGround,
  onTelemetry,
}: {
  mech: PhysicalMechDescription;
  command: SceneCommand;
  debug: DebugOptions;
  paused: boolean;
  slowMotion: boolean;
  fireToken: number;
  resetToken: number;
  onGround: (point: [number, number], faceTarget: boolean) => void;
  onTelemetry: (telemetry: PrototypeTelemetry) => void;
}) {
  return (
    <Canvas
      key={`${mech.id}:${resetToken}`}
      shadows
      dpr={[1, 1.55]}
      camera={{ position: [10.5, 8.5, 12.5], fov: 42, near: 0.1, far: 80 }}
      gl={{ antialias: true }}
    >
      <Suspense fallback={null}>
        <Physics
          debug={debug.physics}
          paused={paused}
          gravity={[0, -9.81, 0]}
          timeStep={slowMotion ? 1 / 120 : 1 / 60}
          interpolate
        >
          <SceneContents
            mech={mech}
            command={command}
            debug={debug}
            fireToken={fireToken}
            onGround={onGround}
            onTelemetry={onTelemetry}
          />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
