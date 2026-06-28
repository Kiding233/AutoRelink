# AutoRelink extprg 迁移设计

**日期**: 2026-06-28  
**状态**: 待实现  

## 背景

AutoRelink 插件当前为纯 JavaScript 单文件 (`extension.js`, 392 行)，运行在 Project Graph 的 Web Worker 中，通过 Comlink Proxy 与主线程通信。

Project Graph 官方推出了 extprg 工具链，提供 TypeScript 类型定义 (`extprg-types`)、脚手架 (`create-extprg`)、热重载开发 (`pnpm dev`) 和标准化打包 (`pnpm package`)。

## 目标

将 AutoRelink 从纯 JS 单文件迁移到 extprg TypeScript 项目，保守拆分模块，清理临时调试代码。

## 文件结构

```
AutoRelink/                          ← 新 extprg 项目根目录
├── src/
│   ├── main.ts                      ← 入口：生命周期 + 快捷键注册
│   ├── algorithm.ts                 ← 八方向区域划分 + 方向解析 + calcRates
│   ├── cache.ts                     ← 矩形缓存 + 边索引 + 历史记录 + getRect
│   └── tick.ts                      ← 主循环 tick() + adjust() 边调整逻辑
├── package.json                     ← 由 create-extprg 生成
├── tsconfig.json                    ← 自动包含 extprg-types
├── metadata.json                    ← 从旧 AutoRelink/ 迁移
└── dist/                            ← pnpm build 输出
```

## 模块职责

### main.ts
- 全局状态：`isAutoRelinkEnabled`、`tickInterval`
- 生命周期：`start()`、`stop()`、`toggle()`
- 快捷键注册：`a r l`（开关）、`a r d`（日志）、`a r p`（性能分析）
- 启动 toast 通知
- 导出 `showLog()`、`showPerf()` 供 keybinds 调用

### algorithm.ts
- `getRegionByEdges(px, py, rect)` — 八方向区域划分
- `isCardinal(d)` — 判断是否四正方向
- `getOpposite(d)` — 获取反方向
- `getRate(d)` — 方向 → Vector 映射
- `resolveDir(hist, dx, dy)` — 历史方向消歧
- `calcRates(refRect, otherRect, hist)` — 计算两端点位置

### cache.ts
- `getRect(entity)` — 安全获取 Rectangle（一次性 await 所有属性，返回纯 JS 对象）
- `getCachedRect(uuid, entity, forceRefresh?, realtimeData?)` — 带 TTL 的矩形缓存
- `buildEdgeIndex(allEdges)` — 构建边索引（Map<uuid, {out, in_}>）
- `getEdgeIndex(allEdges)` — 带缓存的边索引获取
- `getRelatedFromIndex(idx, uid)` — 从索引获取关联
- `getHM(uid)` / `updHist(suid, ruid, reg)` / `getHist(suid, ruid)` / `cleanup(as)` — 历史记录管理
- PerfTimer 类 + `showPerf()` + 日志系统
- 全局缓存变量：`cachedProject`、`cachedSm`、`rectCache`、`cachedEdgeIndex`

### tick.ts
- `tick()` — 主循环（频率控制 + 重叠防护）
- `adjust(edges, ent, uid, rect, relEdges, relRects)` — 边端点调整
- 移动检测逻辑
- 强制调整逻辑

## 调试代码清理

| 保留 | 删除 |
|------|------|
| `PerfTimer` 类 | `[DEBUG-1]` ~ `[DEBUG-14]` 逐行诊断标记 |
| `showPerf()` 快捷键 | 诊断注释（如"关键修复"、"极端测试"） |
| 核心 `log()` 调用 | 临时调优参数注释（`MOVE_THRESHOLD=0`、`FORCE_ADJUST_INTERVAL=200` 等—参数保留，注释删除） |
| `DEBUG_MODE` 开关 | |
| `debugLogs` 日志收集 | |

`DEBUG_MODE` 迁移后默认 `false`。

## 旧文件处置

| 路径 | 操作 |
|------|------|
| `AutoRelink/` | 重命名为 `AutoRelink_legacy/` |
| `AutoRelink_1.0.0/` | 删除 |
| `AutoRelinktest/` | 删除 |
| `pack_extension.py` | 删除 |
| `pack_extension_release.py` | 删除 |
| `pack_extension_test.py` | 删除 |
| `Linklogic.AutoRelink.prg` | 删除（迁移后 `pnpm package` 重新生成） |

## 保留不动

| 路径 | 原因 |
|------|------|
| `project-graph-3.2.2/` | 上游参考源码 |
| `linklogic/` | Python 原型，独立项目 |
| `knowledge*.txt` | 知识库，版本号已同步 |
| `CLAUDE.md` | 项目指引 |
| `backup/` | 归档 |

## 迁移步骤

1. 备份：重命名 `AutoRelink/` → `AutoRelink_legacy/`
2. 脚手架：`pnpm create extprg` 生成新 `AutoRelink/`
3. 移植：按模块逐文件迁移 JS → TS
4. 清理：删除临时调试代码
5. 构建验证：`pnpm build` 通过
6. 功能测试：在 Project Graph 中加载并验证
7. 清理旧文件
