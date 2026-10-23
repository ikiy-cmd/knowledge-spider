export interface SpatialPoint { x: number; y: number; z: number }
export const SPHERE_RADIUS = 500;
export const VIEW_DISTANCE = 1450;
export const SPHERE_EXTENT = SPHERE_RADIUS / Math.sqrt(1 - (SPHERE_RADIUS / VIEW_DISTANCE) ** 2);

export function projectSpatial(point: SpatialPoint): { x: number; y: number; scale: number } {
  const scale = VIEW_DISTANCE / (VIEW_DISTANCE - point.z);
  return { x: point.x * scale, y: point.y * scale, scale };
}

export function rotateSpatialPoint(point: SpatialPoint, yaw: number, pitch: number): SpatialPoint {
  const x = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
  const z = point.z * Math.cos(yaw) - point.x * Math.sin(yaw);
  return { x, y: point.y * Math.cos(pitch) - z * Math.sin(pitch), z: point.y * Math.sin(pitch) + z * Math.cos(pitch) };
}

export function transformSpatial(point: SpatialPoint, axes: readonly SpatialPoint[]): SpatialPoint {
  return {
    x: point.x * axes[0].x + point.y * axes[1].x + point.z * axes[2].x,
    y: point.x * axes[0].y + point.y * axes[1].y + point.z * axes[2].y,
    z: point.x * axes[0].z + point.y * axes[1].z + point.z * axes[2].z,
  };
}

export function sampleSphereArc(a: SpatialPoint, b: SpatialPoint, steps = 20): SpatialPoint[] {
  const radiusA = Math.hypot(a.x, a.y, a.z);
  const radiusB = Math.hypot(b.x, b.y, b.z);
  const count = Math.max(2, Math.round(steps));
  const ua = { x: a.x / (radiusA || 1), y: a.y / (radiusA || 1), z: a.z / (radiusA || 1) };
  const ub = { x: b.x / (radiusB || 1), y: b.y / (radiusB || 1), z: b.z / (radiusB || 1) };
  const dot = Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z));
  const angle = Math.acos(dot);
  const sine = Math.sin(angle);
  // Opposite poles have no unique great circle. Pick the same plane in either direction.
  const sign = (Math.abs(ua.x) > 1e-6 ? ua.x : Math.abs(ua.y) > 1e-6 ? ua.y : ua.z) < 0 ? -1 : 1;
  const canonical = { x: ua.x * sign, y: ua.y * sign, z: ua.z * sign };
  const axis = Math.abs(canonical.y) < 0.8 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cross = { x: canonical.y * axis.z - canonical.z * axis.y, y: canonical.z * axis.x - canonical.x * axis.z, z: canonical.x * axis.y - canonical.y * axis.x };
  const crossLength = Math.hypot(cross.x, cross.y, cross.z) || 1;
  return Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0) return { ...a };
    if (index === count) return { ...b };
    const t = index / count;
    if (radiusA < 1e-6 || radiusB < 1e-6) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    let direction: SpatialPoint;
    if (dot < -0.9999) {
      const c = Math.cos(Math.PI * t);
      const s = Math.sin(Math.PI * t) / crossLength;
      direction = { x: ua.x * c + cross.x * s, y: ua.y * c + cross.y * s, z: ua.z * c + cross.z * s };
    } else if (sine < 1e-5) {
      direction = ua;
    } else {
      const left = Math.sin((1 - t) * angle) / sine;
      const right = Math.sin(t * angle) / sine;
      direction = { x: ua.x * left + ub.x * right, y: ua.y * left + ub.y * right, z: ua.z * left + ub.z * right };
    }
    const radius = (radiusA + (radiusB - radiusA) * t) * (1 - 0.14 * Math.sin(Math.PI * t));
    return { x: direction.x * radius, y: direction.y * radius, z: direction.z * radius };
  });
}
