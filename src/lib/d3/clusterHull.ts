import { polygonHull, polygonCentroid } from "d3-polygon";
import { GRAPH } from "@/lib/config";

/**
 * SVG path for a cluster hull around member positions: an ellipse for
 * exactly 2 points, an outward-expanded convex hull for 3+, and "" when
 * no hull can be drawn yet (fewer than 2 positioned points / degenerate hull).
 */
export function clusterHullPath(points: [number, number][]): string {
  if (points.length === 2) {
    const cx = (points[0][0] + points[1][0]) / 2;
    const cy = (points[0][1] + points[1][1]) / 2;
    const rx = Math.abs(points[0][0] - points[1][0]) / 2 + GRAPH.collideRadius;
    const ry = Math.abs(points[0][1] - points[1][1]) / 2 + GRAPH.collideRadius;
    // Ellipse as SVG path
    return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 -${rx * 2},0`;
  }
  const hull = polygonHull(points);
  if (!hull) return "";
  const centroid = polygonCentroid(hull);
  const expanded = hull.map(([x, y]) => {
    const dx = x - centroid[0];
    const dy = y - centroid[1];
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const pad = GRAPH.collideRadius;
    return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
  });
  return `M${expanded.map((p) => p.join(",")).join("L")}Z`;
}

/**
 * Anchor for a cluster label: horizontally centered over the member points,
 * just above the topmost one.
 */
export function clusterLabelAnchor(points: [number, number][]): { x: number; y: number } {
  // Avoid Math.min(...spread) — fold to stay stack-safe with
  // arbitrarily many cluster points.
  let minY = Infinity;
  for (const p of points) if (p[1] < minY) minY = p[1];
  if (minY === Infinity) minY = 0;
  const avgX = points.reduce((s, p) => s + p[0], 0) / points.length;
  return { x: avgX, y: minY - GRAPH.collideRadius - 8 };
}
