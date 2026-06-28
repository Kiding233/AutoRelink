# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目身份

AutoRelink 插件开发工作区——为 [Project Graph](https://github.com/graphif/project-graph) 桌面应用开发"连线端点自动调整"插件。

## 目录边界

| 区域 | 路径 | 权限 |
|------|------|------|
| **主插件** | `AutoRelink/` | 可修改 |
| 发布副本 | `AutoRelink_1.0.0/` | 可修改（发布前同步） |
| 测试插件 | `AutoRelinktest/` | 可修改 |
| 知识库 | `knowledge*.txt` | 可修改 |
| 打包脚本 | `pack_extension*.py` | 可修改 |
| **上游源码（参考）** | `project-graph-3.2.2/` | **只读，禁止修改** |
| Python 原型 | `linklogic/` | 可修改 |
| 归档/空目录 | `backup/`, `Spread-Inward-Arrow/`, `extension-text-node-todolist-1.0.0/` | 非本项目 |

## 知识库

4 篇 `knowledge_*.txt`（共 ~1968 行），按使用场景拆分：

- `knowledge.txt` — 导航索引
- `knowledge_core.txt` — **日常开发必查**：Comlink 五法则、API 清单、调试工具箱、常见错误
- `knowledge_autorelink.txt` — 算法设计与性能优化实录（O(E)→O(1) 索引缓存，2850ms→150ms）
- `knowledge_architecture.txt` — Project Graph 源码架构（基于 3.0.0 的类体系，待更新至 3.2.2）

## 插件结构

```
AutoRelink/
├── extension.js      ← 插件入口（所有逻辑在此）
├── metadata.json     ← 元数据源文件
└── metadata.msgpack  ← 元数据二进制（由 metadata.json 生成）
```

### 打包命令

```bash
python pack_extension.py          # 开发版 → Linklogic.AutoRelink.prg
python pack_extension_release.py  # 发布版 → Linklogic.AutoRelink_1.0.0.prg
python pack_extension_test.py     # 测试版
```

生成的 `.prg` 文件本质是 zip 包，在 Project Graph 中直接拖入安装。

## 运行时机制

插件运行在 **Web Worker** 中，通过 Comlink 与主线程通信：

- **无 DOM 访问权** — 不能操作 document、window
- **调试输出** — 用 `prg.toast()` 而非 console.log（Worker 中 console 不可见）
- 每个属性访问都是一次跨线程 IPC，频繁 await 会累积延迟

## Comlink 核心约束（来自知识库）

以下规则是插件开发中最容易踩的坑，违反会导致静默失败或抛错：

1. **所有 Proxy 属性都要 await** — `await r.left` 而非 `r.left`，否则得到 `[object Promise]`
2. **async 函数调用必须 await** — 漏掉不会报错，但变量拿到的是 Promise 对象
3. **禁止将 Proxy 存入 Set/Map** — 遍历时会抛 "Cannot convert object to primitive value"。用 UUID 字符串做标识符
4. **尽早将 Proxy 转为普通对象** — 在数据入口处一次性 await 所有属性，封装为纯 JS 对象
5. **修改 edge 属性后必须 `await stageManager.updateReferences()`** — 否则界面不刷新

## 调试约定

插件代码中有一套性能测速系统（`PerfTimer` 类）和日志收集模式（`debugLogs` 数组），由 `DEBUG_MODE` 开关控制。调试时通过 `prg.toast()` 将日志输出到应用右下角弹窗。

## 版本对照

| 知识库标注版本 | 参考源码实际版本 | API 清单状态 |
|---------------|----------------|-------------|
| project-graph-3.2.2 | project-graph-3.2.2 | ✅ 已同步（2026-06-28） |
