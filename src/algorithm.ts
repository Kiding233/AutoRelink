/**
 * 八方向区域划分 + 方向解析算法
 * AutoRelink 核心算法模块
 */

// ── 类型 ──

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: Point;
}

export type Direction =
  | "right" | "left" | "top" | "bottom"
  | "topRight" | "topLeft" | "bottomRight" | "bottomLeft";

export type HistoryEntry = [Direction | null, Direction];

export interface PrgVector {
  _: "Vector";
  x: number;
  y: number;
}

// ── 八方向区域划分 ──

/**
 * 判断点 (px, py) 落在参考矩形 rect 的哪个方位区域
 * 参照系：以 rect 为中心，判断点在其 8 个方向区域中的位置
 */
export function getRegionByEdges(px: number, py: number, rect: Rect): Direction {
  if (px > rect.right && py < rect.top) return "topRight";
  if (px > rect.right && py > rect.bottom) return "bottomRight";
  if (px < rect.left && py < rect.top) return "topLeft";
  if (px < rect.left && py > rect.bottom) return "bottomLeft";
  if (px > rect.right) return "right";
  if (px < rect.left) return "left";
  if (py < rect.top) return "top";
  if (py > rect.bottom) return "bottom";

  const dx = px - rect.center.x;
  const dy = py - rect.center.y;
  return Math.abs(dx) > Math.abs(dy)
    ? dx > 0 ? "right" : "left"
    : dy > 0 ? "bottom" : "top";
}

// ── 方向工具 ──

export function isCardinal(d: Direction): boolean {
  return d === "right" || d === "left" || d === "top" || d === "bottom";
}

export function getOpposite(d: Direction): Direction {
  const map: Record<Direction, Direction> = {
    right: "left", left: "right",
    top: "bottom", bottom: "top",
    topRight: "bottomLeft", topLeft: "bottomRight",
    bottomRight: "topLeft", bottomLeft: "topRight",
  };
  return map[d] ?? "right";
}

export function getRate(d: Direction): { x: number; y: number } {
  const cardinal: Record<string, { x: number; y: number }> = {
    right: { x: 0.99, y: 0.5 },
    left: { x: 0.01, y: 0.5 },
    top: { x: 0.5, y: 0.01 },
    bottom: { x: 0.5, y: 0.99 },
  };
  if (cardinal[d]) return cardinal[d];

  const diag: Record<string, { x: number; y: number }> = {
    topRight: { x: 0.99, y: 0.01 },
    topLeft: { x: 0.01, y: 0.01 },
    bottomRight: { x: 0.99, y: 0.99 },
    bottomLeft: { x: 0.01, y: 0.99 },
  };
  const dg = diag[d];
  if (!dg) return { x: 0.5, y: 0.5 };
  return dg.x < 0.5 ? { x: 0.01, y: 0.5 } : { x: 0.99, y: 0.5 };
}

// ── 方向消歧 ──

/**
 * 根据历史方向对 [prev, curr] 和当前位移 (dx, dy) 消歧，
 * 返回最终方向。规则：
 * - 四正优先于四角
 * - 历史与当前同为四正时跟当前
 * - 历史与当前同为四角时分 v/h 分量比较
 */
export function resolveDir(hist: HistoryEntry, dx: number, dy: number): Direction {
  const [prev, curr] = hist;
  if (prev === null) return curr;

  const pc = isCardinal(prev);
  const cc = isCardinal(curr);

  if (pc && !cc) return prev;
  if (!pc && cc) return curr;
  if (pc && cc) return curr;

  type DiagComponents = { v?: Direction; h?: Direction };
  const gc = (d: Direction): DiagComponents => {
    const m: Record<string, DiagComponents> = {
      topRight: { v: "top", h: "right" },
      topLeft: { v: "top", h: "left" },
      bottomRight: { v: "bottom", h: "right" },
      bottomLeft: { v: "bottom", h: "left" },
    };
    return m[d] ?? {};
  };

  const pg = gc(prev);
  const cg = gc(curr);

  if (pg.v === cg.v) return cg.v!;
  if (pg.h === cg.h) return cg.h!;

  return Math.abs(dx) > Math.abs(dy)
    ? dx > 0 ? "right" : "left"
    : dy > 0 ? "bottom" : "top";
}

// ── 计算两端 rate ──

/**
 * 根据两个矩形的相对位置和历史方向，计算连线两端应使用的端点位置
 * @param refRect 参考节点（选中节点）的矩形
 * @param otherRect 关联节点（目标节点）的矩形
 * @param hist 历史方向对 [prev, curr]
 * @returns {refRate, otherRate} — ref 端和 other 端的 Vector
 */
export function calcRates(
  refRect: Rect,
  otherRect: Rect,
  hist: HistoryEntry,
): { refRate: PrgVector; otherRate: PrgVector } {
  const dx = otherRect.center.x - refRect.center.x;
  const dy = otherRect.center.y - refRect.center.y;
  const rd = resolveDir(hist, dx, dy);
  const linkDir = getOpposite(rd);
  const ref = getRate(linkDir);
  const other = getRate(rd);
  return {
    refRate: { _: "Vector", x: ref.x, y: ref.y },
    otherRate: { _: "Vector", x: other.x, y: other.y },
  };
}
