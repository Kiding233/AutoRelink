/**
 * 主循环：tick() + adjust() — 自包含运行时状态
 * AutoRelink 的核心执行逻辑
 */
import { getRegionByEdges, isCardinal, calcRates } from "./algorithm";
import type { Rect } from "./algorithm";
import {
  getCachedProject, setCachedProject,
  getCachedSm, setCachedSm,
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

export function isEnabled(): boolean {
  return enabled;
}

export function enable(): void {
  enabled = true;
  posMap.clear();
  regionMap.clear();
  lastForceTime = Date.now();
  lastTick = 0;
  busy = false;
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

// ── adjust() ──

/**
 * 调整边端点：对有历史记录的关联边计算新端点并写入
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
      // 选中节点是 target，对端是 source
      ed.e.sourceRectangleRate = { _: "Vector", x: r.otherRate.x, y: r.otherRate.y };
      ed.e.targetRectangleRate = { _: "Vector", x: r.refRate.x, y: r.refRate.y };
      changedCount++;
    } catch (_) { /* skip */ }
  }

  if (changedCount > 0) {
    try {
      await getCachedSm().updateReferences();
    } catch (_) { /* skip */ }
  }

  return changedCount;
}

// ── tick() ──

/**
 * 每 50ms 执行一次的主循环：
 * 1. 获取选中实体
 * 2. 实时检测位移
 * 3. 判断关联节点的八方向区域变化
 * 4. 调用 adjust() 更新边端点
 */
async function tick(): Promise<void> {
  if (!enabled || busy) return;
  const now = Date.now();
  if (now - lastTick < TICK_MS) return;
  busy = true;
  lastTick = now;

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

    // L3 缓存：边索引
    const allEdges = await sm.getEdges();
    const edgeIndex = await getEdgeIndex(allEdges);
    const activeSet = new Set<string>();

    for (const ent of sel) {
      const uid: string = await ent.uuid;
      activeSet.add(uid);

      // 绕过缓存直接读取实时 Rectangle（用于位移检测）
      const rb = await ent.collisionBox.getRectangle();
      const realtimeRect: Rect = {
        left: await rb.left,
        right: await rb.right,
        top: await rb.top,
        bottom: await rb.bottom,
        center: { x: await rb.center.x, y: await rb.center.y },
      };

      // 用实时数据更新缓存 + 读取
      const rect = await getCachedRect(uid, ent, false, realtimeRect);
      const cx = rect.center.x;
      const cy = rect.center.y;

      // ── 位移检测 ──
      const lp = posMap.get(uid);
      let moved = false;
      if (!lp) {
        posMap.set(uid, { x: cx, y: cy, init: true });
      } else if (lp.init) {
        // 第二次进入：强制 moved=true（完成初始化调整）
        posMap.set(uid, { x: cx, y: cy, init: false });
        moved = true;
      } else {
        const dist = Math.sqrt((cx - lp.x) ** 2 + (cy - lp.y) ** 2);
        if (dist > MOVE_THRESHOLD) {
          moved = true;
          posMap.set(uid, { x: cx, y: cy, init: false });
        }
      }

      // 强制调整：大图中采样间隔大，可能漏检移动
      const forceAdjust = !moved && (Date.now() - lastForceTime > FORCE_ADJUST_INTERVAL);
      if (forceAdjust) lastForceTime = Date.now();

      // 从边索引获取关联边
      const { out, in_: ia } = getRelatedFromIndex(edgeIndex, uid);

      // Promise.all 并行获取关联实体引用
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

      // 区域判定 + 历史更新
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
          if (lr === region) continue; // 区域没变，跳过
          regionMap.set(srKey, region);
          if (moved && isCardinal(region)) {
            updHist(uid, ruid, region);
          }
        } catch (_) { /* skip */ }
      }

      await adjust(uid, rect, { out, in_: ia }, relRects);
    }

    cleanup(activeSet);
  } catch (_) {
    /* 静默吞掉异常，下一帧重试 */
  } finally {
    busy = false;
  }
}
