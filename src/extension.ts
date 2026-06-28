/**
 * AutoRelink — 连线端点自动调整
 *
 * 根据节点相对位置自动调整连线端点。
 * 选中节点并拖拽后，连线的端点会自动跳到正确的边缘位置。
 *
 * 快捷键：
 *   a r l — 开关插件
 *   a r d — 显示调试日志
 *   a r p — 显示性能分析
 */
import { enable, disable, isEnabled } from "./tick";
import { resetCache, entityHistory, debugLogs, showPerf } from "./state";

// ── 生命周期 ──

async function start(): Promise<void> {
  if (isEnabled()) return;
  resetCache();
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
  if (isEnabled()) {
    await stop();
  } else {
    await start();
  }
}

// ── 调试辅助 ──

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

export {};
