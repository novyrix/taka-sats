// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Point-in-polygon for the `gps_outlier` detector. Pure, no dependency. Coordinates are
 * GeoJSON order `[lng, lat]`.
 */

export type Ring = readonly (readonly [number, number])[];

/**
 * Is `(lat, lng)` inside `ring` (the polygon's first, outer ring)? A point ON the boundary
 * — an edge or a vertex — counts as INSIDE: a supervisor standing at the fence line is not an
 * outlier. The on-edge test is exact (zero cross product), not a tolerance.
 */
export function pointInRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) {
      continue;
    }
    const [xi, yi] = a;
    const [xj, yj] = b;

    const cross = (lng - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (
      cross === 0 &&
      lng >= Math.min(xi, xj) &&
      lng <= Math.max(xi, xj) &&
      lat >= Math.min(yi, yj) &&
      lat <= Math.max(yi, yj)
    ) {
      return true;
    }
    // Ray casting: a ray to the east crosses this edge.
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
