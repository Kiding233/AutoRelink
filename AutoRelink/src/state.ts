/**
 * 全局状态管理：缓存层 + 历史记录 + 性能测速 + 日志
 * AutoRelink 所有共享状态集中在此模块
 */
import type { Rect } from "./algorithm";

// ── 调试开关 ──
export const DEBUG_MODE = false;

// ── L1: project / stageManager 缓存 ──
let cachedProject: any = null;
let cachedSm: any = null;

export function getCachedProject(): any { return cachedProject; }
export function setCachedProject(v: any): void { cachedProject = v; }
export function getCachedSm(): any { return cachedSm; }
export function setCachedSm(v: any): void { cachedSm = v; }

// ── L2: 矩形缓存 ──
export const RECT_CACHE_TTL = 500;

export interface RectCacheEntry {
  rect: Rect;
  timestamp: number;
}

export const rectCache = new Map<string, RectCacheEntry>();

/**
 * 直接从 Entity 获取 Rectangle 并转为纯 JS 对象（7 次 IPC）
 */
export async function getRect(e: any): Promise<Rect> {
  const r = await e.collisionBox.getRectangle();
  const left = await r.left;
  const right = await r.right;
  const top = await r.top;
  const bottom = await r.bottom;
  const cx = await r.center.x;
  const cy = await r.center.y;
  return { left, right, top, bottom, center: { x: cx, y: cy } };
}

/**
 * 带 TTL 的矩形缓存
 * @param realtimeData 传入实时数据时直接用它更新缓存（0ms IPC 开销）
 */
export async function getCachedRect(
  uuid: string,
  entity: any,
  forceRefresh = false,
  realtimeData: Rect | null = null,
): Promise<Rect> {
  if (realtimeData) {
    rectCache.set(uuid, { rect: realtimeData, timestamp: Date.now() });
    return realtimeData;
  }
  const cached = rectCache.get(uuid);
  const now = Date.now();
  if (!forceRefresh && cached && (now - cached.timestamp) < RECT_CACHE_TTL) {
    return cached.rect;
  }
  const rect = await getRect(entity);
  rectCache.set(uuid, { rect, timestamp: now });
  return rect;
}

// ── L3: 边索引 ──

export interface EdgeIndexEntry {
  e: any;
  tgtUUID?: string;
  srcUUID?: string;
  tgtEntity?: any;
  srcEntity?: any;
}

export let cachedEdgeIndex: Map<string, { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] }> | null = null;
export let cachedEdgeCount = -1;

/**
 * 构建边索引：(源UUID → 出边列表) + (目标UUID → 入边列表)
 * 每个条目预存对端 UUID 和实体引用，后续 adjust 不再需要 IPC
 */
export async function buildEdgeIndex(allEdges: any[]): Promise<Map<string, { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] }>> {
  const idx = new Map<string, { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] }>();
  for (const e of allEdges) {
    try {
      const s = await e.source.uuid;
      const t = await e.target.uuid;
      if (!idx.has(s)) idx.set(s, { out: [], in_: [] });
      if (!idx.has(t)) idx.set(t, { out: [], in_: [] });
      idx.get(s)!.out.push({ e, tgtUUID: t, tgtEntity: e.target });
      idx.get(t)!.in_.push({ e, srcUUID: s, srcEntity: e.source });
    } catch (_) { /* 跳过异常边 */ }
  }
  return idx;
}

/**
 * 获取边索引（边数不变则复用缓存）
 */
export async function getEdgeIndex(allEdges: any[]): Promise<Map<string, { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] }>> {
  if (cachedEdgeIndex === null || allEdges.length !== cachedEdgeCount) {
    cachedEdgeIndex = await buildEdgeIndex(allEdges);
    cachedEdgeCount = allEdges.length;
  }
  return cachedEdgeIndex;
}

export function getRelatedFromIndex(
  idx: Map<string, { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] }>,
  uid: string,
): { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] } {
  return idx.get(uid) ?? { out: [], in_: [] };
}

// ── 历史记录 ──

export const entityHistory = new Map<string, Map<string, [string | null, string]>>();

export function getHM(uid: string): Map<string, [string | null, string]> {
  if (!entityHistory.has(uid)) entityHistory.set(uid, new Map());
  return entityHistory.get(uid)!;
}

/** 更新历史方向对 [prev, curr]，返回 true 表示实际有变化 */
export function updHist(suid: string, ruid: string, reg: string): boolean {
  const m = getHM(suid);
  if (!m.has(ruid)) {
    m.set(ruid, [null, reg]);
    return true;
  }
  const [, c] = m.get(ruid)!;
  if (c === reg) return false;
  m.set(ruid, [c, reg]);
  return true;
}

export function getHist(suid: string, ruid: string): [string | null, string] | null {
  const m = entityHistory.get(suid);
  return m ? (m.get(ruid) ?? null) : null;
}

/** 清理不再选中的实体历史 */
export function cleanup(activeSet: Set<string>): void {
  for (const u of entityHistory.keys()) {
    if (!activeSet.has(u)) entityHistory.delete(u);
  }
}

// ── 日志 ──

export const debugLogs: string[] = [];

export function log(msg: string): void {
  if (!DEBUG_MODE) return;
  debugLogs.push(msg);
  if (debugLogs.length > 20) debugLogs.shift();
}

// ── 性能测速 ──

export let perfLog: { label: string; ms: number; children: { label: string; ms: number }[] }[] = [];
const PERF_MAX = 50;

export class PerfTimer {
  label: string;
  start: number;
  ms: number = 0;
  children: PerfTimer[] = [];

  constructor(label: string) {
    this.label = label;
    this.start = Date.now();
  }

  sub(label: string): PerfTimer {
    const t = new PerfTimer(`${this.label}.${label}`);
    this.children.push(t);
    return t;
  }

  end(): number {
    this.ms = Date.now() - this.start;
    if (perfLog.length > PERF_MAX) perfLog.shift();
    perfLog.push({
      label: this.label,
      ms: this.ms,
      children: this.children.map(c => ({ label: c.label, ms: c.ms })),
    });
    return this.ms;
  }
}

export function showPerf(): void {
  const summary = perfLog.slice(-10).map(p =>
    `${p.label}:${p.ms}ms` +
    (p.children.length ? ` [${p.children.map(c => c.label + ':' + c.ms + 'ms').join(',')}]` : '')
  ).join('\n');
  prg.toast(`📊 性能分析\n${summary}`);
}

// ── 全局缓存重置 ──

export function resetCache(): void {
  setCachedProject(null);
  setCachedSm(null);
  cachedEdgeIndex = null;
  cachedEdgeCount = -1;
  rectCache.clear();
  entityHistory.clear();
  debugLogs.length = 0;
}
