/**
 * 主循环：tick() + adjust() — 自包含运行时状态
 * AutoRelink 的核心执行逻辑
 */
import { getRegionByEdges, calcRates } from "./algorithm";
import type { Rect } from "./algorithm";
import {
  getCachedProject, setCachedProject,
  getCachedSm, setCachedSm,
  getCachedRect, getEdgeIndex, getRelatedFromIndex, getCachedEdges,
  updHist, getHist, cleanup,
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
const TICK_MS = 25;
let lastTick = 0;

// ── 公开控制接口 ──

export function isEnabled(): boolean {
  return enabled;
}

export function enable(): void {
  enabled = true;
  posMap.clear();
  regionMap.clear();
  lastForceTime = Date.now();
  lastTick = 0;
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(tick, TICK_MS);
}

export function disable(): void {
  enabled = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// ── 辅助函数 ──

/** 直接从 Entity 读取实时 Rectangle（7 次 IPC） */
async function getRealtimeRect(ent: any): Promise<Rect> {
  const rb = await ent.collisionBox.getRectangle();
  const [left, right, top, bottom, cx, cy] = await Promise.all([
    rb.left, rb.right, rb.top, rb.bottom, rb.center.x, rb.center.y,
  ]);
  return { left, right, top, bottom, center: { x: cx, y: cy } };
}

// ── adjust()：不再调用 updateReferences ──

/**
 * 调整边端点：对有历史记录的关联边计算新端点并写入
 * @returns 实际修改的边数量（调用方据此决定是否 updateReferences）
 */
async function adjust(
  uid: string,
  rect: Rect,
  relEdges: { out: EdgeIndexEntry[]; in_: EdgeIndexEntry[] },
  relRects: Map<string, Rect>,
): Promise<number> {
  let changedCount = 0;

  // outgoing（选中节点是 source）
  for (const ed of relEdges.out) {
    try {
      const tu = ed.tgtUUID!;
      const h = getHist(uid, tu);
      if (!h) continue;
      const or = relRects.get(tu);
      if (!or) continue;
      const r = calcRates(rect, or, h);
      ed.e.sourceRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  // incoming（选中节点是 target）
  for (const ed of relEdges.in_) {
    try {
      const su = ed.srcUUID!;
      const h = getHist(uid, su);
      if (!h) continue;
      const sr = relRects.get(su);
      if (!sr) continue;
      const r = calcRates(rect, sr, h);
      ed.e.sourceRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  return changedCount;
}

// ── tick()：updateReferences 提到帧尾，只调一次 ──

/**
 * 主循环：
 * 1. 并行获取所有选中实体的 UUID + 实时 Rectangle
 * 2. 位移检测 → 区域判定 → adjust（不调 updateReferences）
 * 3. 帧尾统一调一次 updateReferences
 */
async function tick(): Promise<void> {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastTick < TICK_MS) return;

  try {
    // L1 缓存：project 和 stageManager
    let project = getCachedProject();
    if (!project) {
      project = await prg.tabs_getCurrentProject();
      if (!project) return;
      setCachedProject(project);
    }
    let sm = getCachedSm();
    if (!sm) {
      sm = await project.stageManager;
      setCachedSm(sm);
    }

    // 获取选中实体
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

    // 获取边 + 边索引
    const allEdges = await getCachedEdges(sm);
    const edgeIndex = await getEdgeIndex(allEdges);
    const activeSet = new Set<string>();

    // ═══ 优化 2：并行获取所有选中实体的 UUID + 实时 Rectangle ═══
    const nodeData = await Promise.all(
      sel.map(async (ent) => {
        try {
          const uid: string = await ent.uuid;
          const realtimeRect = await getRealtimeRect(ent);
          return { ent, uid, realtimeRect };
        } catch (_) {
          return null;
        }
      })
    );

    let totalChanges = 0;

    for (const nd of nodeData) {
      if (!nd) continue;
      const { ent, uid, realtimeRect } = nd;
      activeSet.add(uid);

      // 用实时数据更新缓存
      const rect = await getCachedRect(uid, ent, false, realtimeRect);
      const cx = rect.center.x;
      const cy = rect.center.y;

      // ── 位移检测 ──
      const lp = posMap.get(uid);
      let moved = false;
      if (!lp) {
        posMap.set(uid, { x: cx, y: cy, init: true });
      } else if (lp.init) {
        posMap.set(uid, { x: cx, y: cy, init: false });
        moved = true;
      } else {
        const dist = Math.sqrt((cx - lp.x) ** 2 + (cy - lp.y) ** 2);
        if (dist > MOVE_THRESHOLD) {
          moved = true;
          posMap.set(uid, { x: cx, y: cy, init: false });
        }
      }

      // 强制调整
      const forceAdjust = !moved && (Date.now() - lastForceTime > FORCE_ADJUST_INTERVAL);
      if (forceAdjust) lastForceTime = Date.now();

      // 从边索引获取关联边
      const { out, in_: ia } = getRelatedFromIndex(edgeIndex, uid);

      // Parallel 获取关联实体引用
      const outResults = (await Promise.all(
        out.map(async (ed) => {
          try { return { uuid: ed.tgtUUID!, entity: ed.tgtEntity }; } catch (_) { return null; }
        })
      )).filter(Boolean) as { uuid: string; entity: any }[];

      const inResults = (await Promise.all(
        ia.map(async (ed) => {
          try { return { uuid: ed.srcUUID!, entity: ed.srcEntity }; } catch (_) { return null; }
        })
      )).filter(Boolean) as { uuid: string; entity: any }[];

      // 构建关联实体引用表
      const relObjs: Record<string, any> = {};
      for (const r of outResults) relObjs[r.uuid] = r.entity;
      for (const r of inResults) relObjs[r.uuid] = r.entity;

      // ═══ 优化 2：并行获取所有关联实体的 Rectangle ═══
      const relUUIDs = [...outResults, ...inResults].map(r => r.uuid);
      const relRectEntries = (await Promise.all(
        relUUIDs.map(async (ruid) => {
          try {
            const r = relObjs[ruid];
            if (!r) return null;
            const rr = await getCachedRect(ruid, r);
            return { ruid, rr };
          } catch (_) { return null; }
        })
      )).filter(Boolean) as { ruid: string; rr: Rect }[];

      const relRects = new Map<string, Rect>();
      for (const { ruid, rr } of relRectEntries) {
        relRects.set(ruid, rr);

        // 区域判定 + 历史更新
        const region = getRegionByEdges(rect.center.x, rect.center.y, rr);
        const srKey = `${uid}-${ruid}`;
        const lr = regionMap.get(srKey);
        if (lr === region) continue;
        regionMap.set(srKey, region);
        if (moved) {
          updHist(uid, ruid, region);
        }
      }

      // adjust 只写 rate，不调 updateReferences
      totalChanges += await adjust(uid, rect, { out, in_: ia }, relRects);
    }

    cleanup(activeSet);

    // updateReferences 已移除——Canvas 即时模式，
    // sourceRectangleRate 写入 Edge 后下帧渲染自动生效
  } catch (_) {
    /* 静默吞掉异常，下一帧重试 */
  } finally {
    lastTick = Date.now();
  }
}
