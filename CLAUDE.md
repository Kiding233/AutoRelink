# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目身份

AutoRelink 插件开发工作区——为 [Project Graph](https://github.com/graphif/project-graph) 桌面应用开发"连线端点自动调整"插件。

已迁移至 **extprg** 官方工具链（TypeScript + 热重载）。

## 目录边界

| 区域 | 路径 | 权限 |
|------|------|------|
| **主插件（extprg）** | `src/`、`package.json`、`tsconfig.json` | 可修改 |
| 知识库 | `knowledge*.txt` | 可修改 |
| **上游源码（参考）** | `project-graph-3.2.2/` | **只读，禁止修改** |

## 开发命令

```bash
pnpm install      # 安装依赖
pnpm dev          # 开发模式（热重载，自动安装到本地 PG）
pnpm build        # 构建 → dist/extension.js + metadata.msgpack
pnpm package      # 打包 → out/Linklogic.AutoRelink-v1.0.0.prg
pnpm install:ext  # 安装到本地 Project Graph
```

## 项目结构

```
src/
│   ├── extension.ts   ← 入口：生命周期(start/stop/toggle) + 快捷键注册
│   ├── tick.ts        ← 主循环 tick() + adjust() + 运行时状态（enable/disable）
│   ├── algorithm.ts   ← 八方向区域划分 + 方向消歧 + calcRates
│   └── state.ts       ← 全局缓存 + 历史记录 + 性能测速 + 日志
├── package.json       ← extprg 项目配置（name=扩展ID）
├── tsconfig.json      ← TypeScript 配置（types: extprg-types）
├── tsdown.config.ts   ← 打包配置（入口 + 输出格式）
├── metadata.json      ← 扩展元数据（备用，extprg 实际从 package.json 读取）
└── dist/              ← pnpm build 输出（extension.js + metadata.msgpack）
```

### 模块依赖

```
extension.ts ──→ tick.ts ──→ algorithm.ts
     │              │
     └──────────────┼──→ state.ts
                    │
tick.ts ───────────┘
```

- `state.ts` 通过 getter/setter 暴露可变状态，满足 ES Module live binding 限制
- `tick.ts` 自包含运行时状态（enabled/posMap/regionMap），通过 `enable()`/`disable()`/`isEnabled()` 控制

## 运行时机制

插件运行在 **Web Worker** 中，通过 Comlink 与主线程通信。extprg 编译为 ESM 格式（`tsdown`），目标 platform=browser + conditions=worker。

## Comlink 核心约束

1. **所有 Proxy 属性都要 await** — `await r.left` 而非 `r.left`
2. **async 函数调用必须 await** — 漏掉不报错但拿到 Promise 对象
3. **禁止将 Proxy 存入 Set/Map** — 遍历时抛错，用 UUID 字符串替代
4. **尽早将 Proxy 转为纯 JS 对象** — `getRect()` 一次性 await 全部属性
5. **修改 edge 属性后必须 `await sm.updateReferences()`**

## 知识库

4 篇 `knowledge_*.txt`（按使用场景拆分）：
- `knowledge.txt` — 导航索引
- `knowledge_core.txt` — Comlink 法则 + API 清单（已同步至 3.2.2）
- `knowledge_autorelink.txt` — 性能优化实录
- `knowledge_architecture.txt` — PG 源码架构

## 调试

- `DEBUG_MODE` 在 `state.ts` 中，默认 `false`
- 性能测速：`PerfTimer` 类 + `a r p` 快捷键
- 调试日志：`a r d` 快捷键输出 `debugLogs`
