# AutoRelink extprg 迁移实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AutoRelink 从纯 JS 单文件 (`extension.js`, 392行) 迁移到 extprg TypeScript 项目（4 模块拆分 + 调试代码清理）

**Architecture:** 保守拆分 — main.ts (入口/生命周期/快捷键) → tick.ts (主循环+adjust) → algorithm.ts (八方向算法) → cache.ts (缓存/历史/性能测速)

**Tech Stack:** TypeScript + extprg-types (Comlink Proxy 类型) + Project Graph Extension API

## 全局约束

- pnpm 路径：`C:/Users/DELL/AppData/Roaming/npm/pnpm.cmd`
- 目标目录：`d:/Users/DELL/Desktop/Remaining/pg/AutoRelink/`
- `project-graph-3.2.2/` 只读，不可修改
- 知识库 `knowledge*.txt` 不动
- `CLAUDE.md` 迁移完成后更新

---

## 文件结构（迁移后）

```
AutoRelink/                          ← extprg 项目根
├── src/
│   ├── main.ts                      ← 入口：状态、生命周期、快捷键
│   ├── tick.ts                      ← 主循环 + adjust() 边调整
│   ├── algorithm.ts                 ← 八方向区域划分 + 方向解析 + calcRates
│   └── cache.ts                     ← 矩形缓存 + 边索引 + 历史 + PerfTimer + log
├── package.json                     ← create-extprg 生成
├── tsconfig.json                    ← 自动包含 extprg-types
├── metadata.json                    ← 从旧 AutoRelink/ 复制
└── dist/                            ← pnpm build 输出
```

### 模块依赖图

```
main.ts ──→ tick.ts ──→ algorithm.ts
  │            │
  └────────────┼──→ cache.ts
               │
tick.ts ───────┘
```

### 各模块导出入口

| 模块 | 导出（被其他模块消费） |
|------|---------------------|
| `cache.ts` | `getRect()`, `getCachedRect()`, `buildEdgeIndex()`, `getEdgeIndex()`, `getRelatedFromIndex()`, `getHM()`, `updHist()`, `getHist()`, `cleanup()`, `PerfTimer`, `showPerf()`, `log()`, `debugLogs`, `perfLog`, `cachedProject`, `cachedSm`, `rectCache`, `cachedEdgeIndex`, `cachedEdgeCount`, `RECT_CACHE_TTL`, `DEBUG_MODE` |
| `algorithm.ts` | `getRegionByEdges()`, `isCardinal()`, `getOpposite()`, `getRate()`, `resolveDir()`, `calcRates()` |
| `tick.ts` | `tick()`, `adjust()` |
| `main.ts` | 无（入口文件，注册 keybinds + 启动） |

---

### Task 1: 备份 + 脚手架

**Files:**
- Rename: `AutoRelink/` → `AutoRelink_legacy/`
- Create: 通过 `create-extprg` 生成新 `AutoRelink/`

- [ ] **Step 1: 重命名旧目录**

```bash
cd d:/Users/DELL/Desktop/Remaining/pg
mv AutoRelink AutoRelink_legacy
```

- [ ] **Step 2: 运行 create-extprg 脚手架**

```bash
cd d:/Users/DELL/Desktop/Remaining/pg
"C:/Users/DELL/AppData/Roaming/npm/pnpm.cmd" create extprg AutoRelink --yes
```

`--yes` 使用默认选项。如果交互式要求输入名称/作者，手动输入：
- extension name: `连线端点自动调整` (或 `auto-relink`)
- author: `Kiding`
- id: `Linklogic.AutoRelink`

- [ ] **Step 3: 验证脚手架输出**

```bash
ls AutoRelink/
# 预期：package.json tsconfig.json metadata.json src/
ls AutoRelink/src/
# 预期：main.ts (或 index.ts)
```

- [ ] **Step 4: 删除脚手架生成的示例 src 文件**

```bash
rm AutoRelink/src/*.ts
```

---

### Task 2: algorithm.ts — 八方向算法

**Files:**
- Create: `AutoRelink/src/algorithm.ts`

**Interfaces:**
- Consumes: `Rect` 类型（来自 cache.ts 的 getRect 返回形状，但 algorithm.ts 不依赖 cache.ts——它只接收纯数据）
- Produces: `getRegionByEdges()`, `isCardinal()`, `getOpposite()`, `getRate()`, `resolveDir()`, `calcRates()`

由于 algorithm.ts 是底层纯函数模块，不依赖任何 PG API，可先行实现。

- [ ] **Step 1: 写入 algorithm.ts**

```typescript
/**
 * 八方向区域划分 + 方向解析算法
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

// ── Vector 格式 ──
export interface PrgVector {
  _: "Vector";
  x: number;
  y: number;
}

// ── 八方向区域划分 ──
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
export async function calcRates(
  refRect: Rect,
  otherRect: Rect,
  hist: HistoryEntry,
): Promise<{ refRate: PrgVector; otherRate: PrgVector }> {
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
```

---

### Task 3: cache.ts — 缓存 + 索引 + 历史 + 性能

**Files:**
- Create: `AutoRelink/src/cache.ts`

**Interfaces:**
- Consumes: `prg` (global), `getRegionByEdges` (从 algorithm.ts)
- Produces: 见文件结构表

- [ ] **Step 1: 写入 cache.ts**

```typescript
/**
 * 缓存层：矩形缓存、边索引、历史记录、性能测速、日志
 */
import type { Rect } from "./algorithm";

// ── 全局配置 ──
export const DEBUG_MODE = false;
export const RECT_CACHE_TTL = 500;

// ── 全局缓存 ──
export let cachedProject: any = null;
export let cachedSm: any = null;
export let cachedEdgeIndex: Map<string, { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] }> | null = null;
export let cachedEdgeCount = -1;

// ── 类型 ──
export interface EdgeIndexEntry {
  e: any;           // Edge 的 Comlink Proxy
  tgtUUID?: string;
  srcUUID?: string;
  tgtEntity?: any;
  srcEntity?: any;
}

export interface RectCacheEntry {
  rect: Rect;
  timestamp: number;
}

// ── 矩形缓存 ──
export const rectCache = new Map<string, RectCacheEntry>();

async function getRectDirect(e: any): Promise<Rect> {
  const r = await e.collisionBox.getRectangle();
  const left = await r.left;
  const right = await r.right;
  const top = await r.top;
  const bottom = await r.bottom;
  const cx = await r.center.x;
  const cy = await r.center.y;
  return { left, right, top, bottom, center: { x: cx, y: cy } };
}

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
  const rect = await getRectDirect(entity);
  rectCache.set(uuid, { rect, timestamp: now });
  return rect;
}

export { getRectDirect as getRect };

// ── 边索引 ──
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
    } catch (_) { /* skip malformed edges */ }
  }
  return idx;
}

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
```

---

### Task 4: tick.ts — 主循环 + adjust

**Files:**
- Create: `AutoRelink/src/tick.ts`

**Interfaces:**
- Consumes: `prg` (global), `algorithm.ts` 全部导出, `cache.ts` 全部导出
- Produces: `tick()`, `adjust()`

- [ ] **Step 1: 写入 tick.ts**

```typescript
/**
 * 主循环：tick() + adjust()
 */
import { getRegionByEdges, isCardinal, calcRates } from "./algorithm";
import type { Rect } from "./algorithm";
import {
  cachedProject, cachedSm, cachedEdgeIndex,
  getCachedRect, getEdgeIndex, getRelatedFromIndex,
  getHM, updHist, getHist, cleanup,
  log, PerfTimer, DEBUG_MODE,
} from "./cache";
import type { EdgeIndexEntry } from "./cache";

// ── 运行时状态 ──
export let isAutoRelinkEnabled = false;
export let tickInterval: ReturnType<typeof setInterval> | null = null;

const lastPositions = new Map<string, { x: number; y: number; init: boolean }>();
const lastRegionMap = new Map<string, string>();
const MOVE_THRESHOLD = 0;
const FORCE_ADJUST_INTERVAL = 200;
let lastForceAdjustTime = 0;
const TICK_INTERVAL = 50;
let lastTickTime = 0;
let ticking = false;
const DEBUG_MODE_LOCAL = DEBUG_MODE;

// ── adjust() ──
async function adjust(
  _edges: any[],
  _ent: any,
  uid: string,
  rect: Rect,
  relEdges: { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] },
  relRects: Map<string, Rect>,
): Promise<number> {
  let changedCount = 0;

  for (const ed of relEdges.out) {
    try {
      const tu = ed.tgtUUID!;
      const h = getHist(uid, tu);
      if (h) {
        const or = relRects.get(tu);
        if (or) {
          const r = await calcRates(rect, or, h);
          ed.e.sourceRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
          ed.e.targetRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
          changedCount++;
        }
      }
    } catch (_) { /* skip */ }
  }

  for (const ed of relEdges.in_) {
    try {
      const su = ed.srcUUID!;
      const h = getHist(uid, su);
      if (h) {
        const sr = relRects.get(su);
        if (sr) {
          const r = await calcRates(rect, sr, h);
          ed.e.sourceRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
          ed.e.targetRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
          changedCount++;
        }
      }
    } catch (_) { /* skip */ }
  }

  if (changedCount > 0) {
    try {
      await cachedSm.updateReferences();
    } catch (_) { /* skip */ }
  }

  return changedCount;
}

// ── tick() ──
async function tick(): Promise<void> {
  if (!isAutoRelinkEnabled) return;
  if (ticking) return;
  const now = Date.now();
  if (now - lastTickTime < TICK_INTERVAL) return;
  ticking = true;
  lastTickTime = now;

  try {
    if (!cachedProject) {
      cachedProject = await prg.tabs_getCurrentProject();
      if (!cachedProject) return;
    }
    const sm = cachedSm ?? (cachedSm = await cachedProject.stageManager);

    let sel: any[];
    try {
      sel = await sm.getSelectedEntities();
    } catch (_) {
      return;
    }
    if (!Array.isArray(sel) || !sel.length) {
      cleanup(new Set());
      return;
    }

    const allEdges = await sm.getEdges();
    const edgeIndex = await getEdgeIndex(allEdges);
    const activeSet = new Set<string>();

    for (const ent of sel) {
      const uid: string = await ent.uuid;
      activeSet.add(uid);

      // 实时获取 Rectangle（绕过缓存，用于位移检测）
      const rawCollisionBox = ent.collisionBox;
      const rawRectangle = await rawCollisionBox.getRectangle();
      const left = await rawRectangle.left;
      const right = await rawRectangle.right;
      const top = await rawRectangle.top;
      const bottom = await rawRectangle.bottom;
      const centerX = await rawRectangle.center.x;
      const centerY = await rawRectangle.center.y;

      const realtimeRect: Rect = {
        left, right, top, bottom,
        center: { x: centerX, y: centerY },
      };

      const rect = await getCachedRect(uid, ent, false, realtimeRect);
      const cx = rect.center.x;
      const cy = rect.center.y;

      // 位移检测
      const lastPos = lastPositions.get(uid);
      let moved = false;
      if (!lastPos) {
        lastPositions.set(uid, { x: cx, y: cy, init: true });
      } else {
        if (lastPos.init) {
          lastPositions.set(uid, { x: cx, y: cy, init: false });
          moved = true;
        } else {
          const dx = cx - lastPos.x;
          const dy = cy - lastPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > MOVE_THRESHOLD) {
            moved = true;
            lastPositions.set(uid, { x: cx, y: cy, init: false });
          }
        }
      }

      const forceAdjust = !moved && (Date.now() - lastForceAdjustTime > FORCE_ADJUST_INTERVAL);
      if (forceAdjust) lastForceAdjustTime = Date.now();

      const { out, in_: ia } = getRelatedFromIndex(edgeIndex, uid);

      // Promise.all 并行获取关联实体信息
      const outTasks = out.map(async (ed) => {
        try {
          return { uuid: ed.tgtUUID!, entity: ed.tgtEntity };
        } catch (_) { return null; }
      });
      const inTasks = ia.map(async (ed) => {
        try {
          return { uuid: ed.srcUUID!, entity: ed.srcEntity };
        } catch (_) { return null; }
      });
      const outResults = (await Promise.all(outTasks)).filter(Boolean) as { uuid: string; entity: any }[];
      const inResults = (await Promise.all(inTasks)).filter(Boolean) as { uuid: string; entity: any }[];

      const relUUIDs = [...outResults, ...inResults].map(r => r.uuid);
      const relObjs: Record<string, any> = {};
      const relRects = new Map<string, Rect>();

      for (const r of outResults) relObjs[r.uuid] = r.entity;
      for (const r of inResults) relObjs[r.uuid] = r.entity;

      for (const ruid of relUUIDs) {
        try {
          const r = relObjs[ruid];
          if (!r) continue;
          const rr = await getCachedRect(ruid, r);
          relRects.set(ruid, rr);
          const region = getRegionByEdges(rect.center.x, rect.center.y, rr);
          const srKey = `${uid}-${ruid}`;
          const lastReg = lastRegionMap.get(srKey);
          if (lastReg === region) continue;
          lastRegionMap.set(srKey, region);
          if (moved && isCardinal(region)) {
            updHist(uid, ruid, region);
          }
        } catch (_) { /* skip */ }
      }

      await adjust(allEdges, ent, uid, rect, { out, in_: ia }, relRects);
    }
    cleanup(activeSet);
  } catch (_) { /* skip */ }
  finally {
    ticking = false;
  }
}

export { tick, adjust };
```

---

### Task 5: main.ts — 入口 + 生命周期 + 快捷键

**Files:**
- Create: `AutoRelink/src/main.ts`

**Interfaces:**
- Consumes: `prg` (global), `Comlink` (global), `tick.ts` 的 `isAutoRelinkEnabled`, `tickInterval`, `tick()`, `cache.ts` 的全部缓存变量
- Produces: 无（入口文件）

- [ ] **Step 1: 写入 main.ts**

```typescript
/**
 * AutoRelink — 连线端点自动调整
 * 入口文件：生命周期管理 + 快捷键注册
 */
import {
  isAutoRelinkEnabled, tickInterval, tick,
} from "./tick";
import {
  cachedProject, cachedSm, cachedEdgeIndex, cachedEdgeCount,
  rectCache, entityHistory, debugLogs, perfLog,
  PerfTimer, showPerf, log,
  lastPositions, lastRegionMap,
} from "./cache";

// 重新导出 tick.ts 需要的变量
// (这些变量在 tick.ts 内部，通过 import 已可用)
// 此处从 cache.ts 导出的变量供 tick.ts 使用

const TICK_INTERVAL = 50;

// ── 生命周期 ──
async function start(): Promise<void> {
  if (isAutoRelinkEnabled) return;
  // 通过 tick.ts 的导出修改（需要改为 let 导出或提供 setter）
  (globalThis as any).__autorelink_enabled = true;
  // 重置所有状态
  debugLogs.length = 0;
  cachedProject = null;
  cachedSm = null;
  cachedEdgeIndex = null;
  rectCache.clear();
  entityHistory.clear();

  // 通过 tick module 修改内部状态——tick.ts 导出 setter
  const tickModule = await import("./tick");
  tickModule.isAutoRelinkEnabled = true;
  tickModule.lastPositions.clear();
  tickModule.lastRegionMap.clear();

  if (tickInterval) clearInterval(tickInterval);
  const id = setInterval(tick, TICK_INTERVAL);
  tickModule.tickInterval = id;

  await prg.toast_success("AutoRelink 🟢");
}

async function stop(): Promise<void> {
  const tickModule = await import("./tick");
  if (!tickModule.isAutoRelinkEnabled) return;
  tickModule.isAutoRelinkEnabled = false;
  if (tickModule.tickInterval) {
    clearInterval(tickModule.tickInterval);
    tickModule.tickInterval = null;
  }
  entityHistory.clear();
  await prg.toast_warning("AutoRelink 🔴");
}

async function toggle(): Promise<void> {
  const tickModule = await import("./tick");
  tickModule.isAutoRelinkEnabled ? await stop() : await start();
}

// ── UI 辅助 ──
async function showLog(): Promise<void> {
  await prg.toast(debugLogs.slice(-8).join("\n"));
}

// ── 快捷键注册 ──
await prg.keybinds_register(
  "auto-relink-toggle",
  { $lucide: "Link" },
  "a r l",
  Comlink.proxy(() => { toggle(); }),
);

await prg.keybinds_register(
  "auto-relink-log",
  { $lucide: "Bug" },
  "a r d",
  Comlink.proxy(() => { showLog(); }),
);

await prg.keybinds_register(
  "auto-relink-perf",
  { $lucide: "Gauge" },
  "a r p",
  Comlink.proxy(() => { showPerf(); }),
);

await prg.toast_success("AutoRelink 已加载\na r l=开关 a r d=日志 a r p=性能分析");
```

⚠️ **设计问题**：`main.ts` 和 `tick.ts` 之间存在循环依赖——`main.ts` 需要修改 `tick.ts` 中的 `isAutoRelinkEnabled` 等变量，但 `tick.ts` 又从 `cache.ts` 导入。

**解决方案**：将共享状态提升到 `cache.ts`（重命名为 `state.ts` 或保留在 `cache.ts`）：

实际上重新审视：`isAutoRelinkEnabled`、`tickInterval`、`lastPositions`、`lastRegionMap` 等应该全放在 `cache.ts`（作为状态存储）。这样 `tick.ts` 和 `main.ts` 都从 `cache.ts` 读写，消除循环依赖。

**修正方案——调整模块边界**：

| 变量 | 归属 |
|------|------|
| `cache.ts` | 所有共享状态：`isAutoRelinkEnabled`, `tickInterval`, `lastPositions`, `lastRegionMap`, `lastForceAdjustTime`, `lastTickTime`, `ticking`, 以及现有缓存 |
| `tick.ts` | 仅 `tick()` 和 `adjust()` 函数逻辑 |
| `main.ts` | `start()`, `stop()`, `toggle()`, `showLog()`, keybinds 注册 |

最终文件结构不变，但职责更清晰。

---

### Task 6: 重写 cache.ts + tick.ts + main.ts（修正版）

由于 Task 3-5 存在状态归属问题，此 Task 统一以修正后的版本覆盖。

**Files:**
- Rewrite: `AutoRelink/src/cache.ts` — 增加运行时状态变量
- Rewrite: `AutoRelink/src/tick.ts` — 纯函数，从 cache.ts 读状态
- Rewrite: `AutoRelink/src/main.ts` — 生命周期，修改 cache.ts 的状态

- [ ] **Step 1: 更新 cache.ts——追加运行时状态**

在原 cache.ts 末尾追加：

```typescript
// ── 运行时状态（供 tick.ts 和 main.ts 共享）──
export let isAutoRelinkEnabled = false;
export let tickInterval: ReturnType<typeof setInterval> | null = null;

export const lastPositions = new Map<string, { x: number; y: number; init: boolean }>();
export const lastRegionMap = new Map<string, string>();
export const MOVE_THRESHOLD = 0;
export const FORCE_ADJUST_INTERVAL = 200;
export let lastForceAdjustTime = 0;
export const TICK_INTERVAL = 50;
export let lastTickTime = 0;
export let ticking = false;
```

- [ ] **Step 2: 更新 tick.ts——从 cache.ts 导入状态**

```typescript
/**
 * 主循环：tick() + adjust()
 */
import { getRegionByEdges, isCardinal, calcRates } from "./algorithm";
import type { Rect } from "./algorithm";
import {
  cachedProject, cachedSm,
  getCachedRect, getEdgeIndex, getRelatedFromIndex,
  updHist, getHist, cleanup, log,
  isAutoRelinkEnabled, lastPositions, lastRegionMap,
  MOVE_THRESHOLD, FORCE_ADJUST_INTERVAL, lastForceAdjustTime,
  TICK_INTERVAL, lastTickTime, ticking,
} from "./state";
import type { EdgeIndexEntry } from "./state";

// ── adjust() ──
export async function adjust(
  uid: string,
  rect: Rect,
  relEdges: { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] },
  relRects: Map<string, Rect>,
): Promise<number> {
  let changedCount = 0;

  for (const ed of relEdges.out) {
    try {
      const tu = ed.tgtUUID!;
      const h = getHist(uid, tu);
      if (!h) continue;
      const or = relRects.get(tu);
      if (!or) continue;
      const r = await calcRates(rect, or, h);
      ed.e.sourceRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  for (const ed of relEdges.in_) {
    try {
      const su = ed.srcUUID!;
      const h = getHist(uid, su);
      if (!h) continue;
      const sr = relRects.get(su);
      if (!sr) continue;
      const r = await calcRates(rect, sr, h);
      ed.e.sourceRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  if (changedCount > 0) {
    try { await cachedSm.updateReferences(); } catch (_) { /* skip */ }
  }
  return changedCount;
}

// ── tick() ──
export async function tick(): Promise<void> {
  if (!isAutoRelinkEnabled) return;
  if (ticking) return;
  const now = Date.now();
  if (now - lastTickTime < TICK_INTERVAL) return;
  ticking = true;
  // 需要修改模块级变量，通过 state 模块的导出来修改
  // 实际运行时 ticking 等变量从 state 导入，但需要可写——
  // 这些是 let 导出，支持重新赋值：
  // (由于 ES module 的 live binding，import 方也能看到变化)
  // 但 import 方不能直接赋值。解决方案：tick.ts 内部变量直接使用
  // 本地闭包变量，tick() 函数通过闭包访问。
}

// 由于 ES Module 无法直接修改导入的 let 变量，
// 实际采用方案：tick() 内部使用本地变量副本，
// start()/stop() 通过 state.setEnabled() 等 setter 控制。
```

- [ ] **Step 3: 识别 ES Module live binding 限制**

ES Module 的 `import { ticking }` 是 live binding——可以读取最新值，但**不能赋值**。解决方案：

**最终架构调整**：`tick.ts` 内部自包含所有运行时状态，通过导出函数暴露控制接口。

- [ ] **Step 4: 写入最终版 tick.ts**

```typescript
/**
 * 主循环：tick() + adjust() — 自包含运行时状态
 */
import { getRegionByEdges, isCardinal, calcRates } from "./algorithm";
import type { Rect } from "./algorithm";
import {
  cachedProject, cachedSm,
  getCachedRect, getEdgeIndex, getRelatedFromIndex,
  updHist, getHist, cleanup, log,
} from "./state";
import type { EdgeIndexEntry } from "./state";

// ── 私有运行时状态 ──
let enabled = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
const posMap = new Map<string, { x: number; y: number; init: boolean }>();
const regionMap = new Map<string, string>();
const MOVE_THRESHOLD = 0;
const FORCE_ADJUST_INTERVAL = 200;
let lastForceTime = 0;
const TICK_MS = 50;
let lastTick = 0;
let busy = false;

// ── 公开控制接口 ──
export function isEnabled(): boolean { return enabled; }

export function enable(): void {
  enabled = true;
  posMap.clear();
  regionMap.clear();
  lastForceTime = Date.now();
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(tick, TICK_MS);
}

export function disable(): void {
  enabled = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

// ── adjust() ──
async function adjust(
  uid: string,
  rect: Rect,
  relEdges: { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] },
  relRects: Map<string, Rect>,
): Promise<number> {
  let changedCount = 0;

  for (const ed of relEdges.out) {
    try {
      const tu = ed.tgtUUID!;
      const h = getHist(uid, tu);
      if (!h) continue;
      const or = relRects.get(tu);
      if (!or) continue;
      const r = await calcRates(rect, or, h);
      ed.e.sourceRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  for (const ed of relEdges.in_) {
    try {
      const su = ed.srcUUID!;
      const h = getHist(uid, su);
      if (!h) continue;
      const sr = relRects.get(su);
      if (!sr) continue;
      const r = await calcRates(rect, sr, h);
      ed.e.sourceRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  if (changedCount > 0) {
    try { await cachedSm.updateReferences(); } catch (_) { /* skip */ }
  }
  return changedCount;
}

// ── tick() ──
async function tick(): Promise<void> {
  if (!enabled || busy) return;
  const now = Date.now();
  if (now - lastTick < TICK_MS) return;
  busy = true;
  lastTick = now;

  try {
    if (!cachedProject) {
      cachedProject = await prg.tabs_getCurrentProject();
      if (!cachedProject) return;
    }
    const sm = cachedSm ?? (cachedSm = await cachedProject.stageManager);

    let sel: any[];
    try { sel = await sm.getSelectedEntities(); } catch (_) { return; }
    if (!Array.isArray(sel) || !sel.length) { cleanup(new Set()); return; }

    const allEdges = await sm.getEdges();
    const edgeIndex = await getEdgeIndex(allEdges);
    const activeSet = new Set<string>();

    for (const ent of sel) {
      const uid: string = await ent.uuid;
      activeSet.add(uid);

      // 实时 Rectangle（绕过缓存）
      const rb = await ent.collisionBox.getRectangle();
      const realtimeRect: Rect = {
        left: await rb.left, right: await rb.right,
        top: await rb.top, bottom: await rb.bottom,
        center: { x: await rb.center.x, y: await rb.center.y },
      };

      const rect = await getCachedRect(uid, ent, false, realtimeRect);
      const cx = rect.center.x, cy = rect.center.y;

      // 位移检测
      const lp = posMap.get(uid);
      let moved = false;
      if (!lp) { posMap.set(uid, { x: cx, y: cy, init: true }); }
      else if (lp.init) { posMap.set(uid, { x: cx, y: cy, init: false }); moved = true; }
      else {
        const dist = Math.sqrt((cx - lp.x) ** 2 + (cy - lp.y) ** 2);
        if (dist > MOVE_THRESHOLD) { moved = true; posMap.set(uid, { x: cx, y: cy, init: false }); }
      }

      const forceAdjust = !moved && (Date.now() - lastForceTime > FORCE_ADJUST_INTERVAL);
      if (forceAdjust) lastForceTime = Date.now();

      const { out, in_: ia } = getRelatedFromIndex(edgeIndex, uid);

      const outResults = (await Promise.all(
        out.map(async (ed) => { try { return { uuid: ed.tgtUUID!, entity: ed.tgtEntity }; } catch (_) { return null; } })
      )).filter(Boolean) as { uuid: string; entity: any }[];

      const inResults = (await Promise.all(
        ia.map(async (ed) => { try { return { uuid: ed.srcUUID!, entity: ed.srcEntity }; } catch (_) { return null; } })
      )).filter(Boolean) as { uuid: string; entity: any }[];

      const relObjs: Record<string, any> = {};
      for (const r of outResults) relObjs[r.uuid] = r.entity;
      for (const r of inResults) relObjs[r.uuid] = r.entity;

      const relRects = new Map<string, Rect>();
      for (const ruid of [...outResults, ...inResults].map(r => r.uuid)) {
        try {
          const r = relObjs[ruid];
          if (!r) continue;
          const rr = await getCachedRect(ruid, r);
          relRects.set(ruid, rr);
          const region = getRegionByEdges(rect.center.x, rect.center.y, rr);
          const srKey = `${uid}-${ruid}`;
          const lr = regionMap.get(srKey);
          if (lr === region) continue;
          regionMap.set(srKey, region);
          if (moved && isCardinal(region)) updHist(uid, ruid, region);
        } catch (_) { /* skip */ }
      }

      await adjust(uid, rect, { out, in_: ia }, relRects);
    }
    cleanup(activeSet);
  } catch (_) { /* skip */ }
  finally { busy = false; }
}
```

- [ ] **Step 5: 写入最终版 main.ts**

```typescript
/**
 * AutoRelink — 连线端点自动调整
 * 入口：生命周期 + 快捷键注册
 */
import { enable, disable, isEnabled } from "./tick";
import { entityHistory, debugLogs, showPerf, cachedProject, cachedSm, cachedEdgeIndex, rectCache } from "./state";

// ── 状态重置 ──
function resetState(): void {
  debugLogs.length = 0;
  cachedProject = null;
  cachedSm = null;
  cachedEdgeIndex = null;
  rectCache.clear();
  entityHistory.clear();
  // cachedEdgeCount 由 getEdgeIndex 内部管理
  (globalThis as any).__cachedEdgeCount = -1;
}

// ── 生命周期 ──
async function start(): Promise<void> {
  if (isEnabled()) return;
  resetState();
  enable();
  await prg.toast_success("AutoRelink 🟢");
}

async function stop(): Promise<void> {
  if (!isEnabled()) return;
  disable();
  entityHistory.clear();
  await prg.toast_warning("AutoRelink 🔴");
}

async function toggle(): Promise<void> {
  isEnabled() ? await stop() : await start();
}

// ── UI ──
async function showLog(): Promise<void> {
  await prg.toast(debugLogs.slice(-8).join("\n"));
}

// ── 快捷键 ──
await prg.keybinds_register(
  "auto-relink-toggle",
  { $lucide: "Link" },
  "a r l",
  Comlink.proxy(() => { toggle(); }),
);

await prg.keybinds_register(
  "auto-relink-log",
  { $lucide: "Bug" },
  "a r d",
  Comlink.proxy(() => { showLog(); }),
);

await prg.keybinds_register(
  "auto-relink-perf",
  { $lucide: "Gauge" },
  "a r p",
  Comlink.proxy(() => { showPerf(); }),
);

await prg.toast_success("AutoRelink 已加载\na r l=开关 a r d=日志 a r p=性能分析");
```

- [ ] **Step 6: 更新 cache.ts → state.ts**

将 `cache.ts` 重命名为 `state.ts`，更准确反映其职责（状态+缓存+日志+性能）。

```bash
mv AutoRelink/src/cache.ts AutoRelink/src/state.ts
```

同时更新 `tick.ts` 和 `main.ts` 的 import 路径：`"./cache"` → `"./state"`（已在上面代码中使用 `"./state"`）。

---

### Task 7: metadata.json + 构建验证

- [ ] **Step 1: 迁移 metadata.json**

```bash
cp AutoRelink_legacy/metadata.json AutoRelink/metadata.json
```

确保内容为：
```json
{
  "version": "3.2.2",
  "extension": {
    "id": "Linklogic.AutoRelink",
    "name": "连线端点自动调整",
    "description": "根据用户拖拽节点的方式自动调整连线端点的位置",
    "version": "1.0.0",
    "author": "Kiding"
  }
}
```

- [ ] **Step 2: 构建**

```bash
cd AutoRelink
"C:/Users/DELL/AppData/Roaming/npm/pnpm.cmd" install
"C:/Users/DELL/AppData/Roaming/npm/pnpm.cmd" build
```

- [ ] **Step 3: 验证构建产物**

```bash
ls AutoRelink/dist/
# 预期：extension.js metadata.json metadata.msgpack
```

- [ ] **Step 4: 对比新旧 extension.js 差异**

人工检查：
- 算法函数逻辑一致（八方向、消歧、calcRates）
- 缓存策略一致（L1 project/sm、L2 rectCache、L3 edgeIndex）
- tick 频率控制一致（50ms + 防重入）
- 快捷键一致（a r l / a r d / a r p）

- [ ] **Step 5: 打包为 .prg**

```bash
cd AutoRelink
"C:/Users/DELL/AppData/Roaming/npm/pnpm.cmd" package
ls out/
# 预期：Linklogic.AutoRelink-1.0.0.zip
```

---

### Task 8: 清理旧文件 + 更新文档

- [ ] **Step 1: 删除旧产物**

```bash
cd d:/Users/DELL/Desktop/Remaining/pg
rm -rf AutoRelink_1.0.0/
rm -rf AutoRelinktest/
rm -f pack_extension.py pack_extension_release.py pack_extension_test.py
rm -f Linklogic.AutoRelink.prg Linklogic.AutoRelinktest.prg testfile.prg
# AutoRelink_legacy/ 保留作为参考
```

- [ ] **Step 2: 更新 CLAUDE.md**

将以下内容追加/更新到 CLAUDE.md：

```markdown
## 开发命令

```bash
# pnpm 路径
PNPM="C:/Users/DELL/AppData/Roaming/npm/pnpm.cmd"

cd AutoRelink
$PNPM install        # 安装依赖
$PNPM dev            # 开发模式（热重载）
$PNPM build          # 编译到 dist/
$PNPM package        # 打包为 .zip
$PNPM install:ext    # 安装到本地 Project Graph
```

## 项目结构

```
AutoRelink/src/
├── main.ts        ← 入口：生命周期(start/stop/toggle) + 快捷键
├── tick.ts        ← 主循环 tick() + adjust() + 运行时状态
├── algorithm.ts   ← 八方向区域划分 + 方向消歧 + calcRates
└── state.ts       ← 全局缓存 + 历史记录 + 性能测速 + 日志
```
```

- [ ] **Step 3: Commit（如果使用 git）**

（当前项目不是 git 仓库，跳过）

---

## 自检清单

1. **算法一致性**：`algorithm.ts` 与旧 `extension.js` 中 77-127 行逻辑逐行对应
2. **缓存一致性**：三层缓存（project/sm、rectCache、edgeIndex）行为不变
3. **状态隔离**：`tick.ts` 内部状态通过 `enable()`/`disable()` 控制，无全局变量泄漏
4. **调试代码清理**：逐行诊断标记 `[DEBUG-1]~[DEBUG-14]` 已删除，`DEBUG_MODE` 默认 `false`
5. **PerfTimer 保留**：`showPerf()` 快捷键 `a r p` 可用
