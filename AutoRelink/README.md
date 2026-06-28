# AutoRelink — 连线端点自动调整

根据节点相对位置自动调整连线端点的 Project Graph 扩展。

## 开发

```bash
npx extprg build    # 构建 → dist/
npx extprg package  # 打包 → out/Linklogic.AutoRelink-v1.0.0.prg
```

## 安装

将 `.prg` 文件拖入 Project Graph 窗口，或手动复制到扩展目录：

```bash
cp dist/extension.js "$APPDATA/liren.project-graph/extensions/Linklogic.AutoRelink/"
cp dist/metadata.msgpack "$APPDATA/liren.project-graph/extensions/Linklogic.AutoRelink/"
```

## 使用

- `a r l` — 开关插件
- `a r d` — 显示调试日志
- `a r p` — 显示性能分析

## 发布

1. `npx extprg package` 生成 `.prg` 文件
2. 上传到 GitHub Releases
3. 用户拖入 Project Graph 即可安装
