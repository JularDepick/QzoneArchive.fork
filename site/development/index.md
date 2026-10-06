---
title: 开发
---

# 开发

## 前置条件

- Node.js 20+

```bash
npm ci
npm run dev
```

常用校验命令: `npm run typecheck`, `npm run selftest`, `npm run smoke`。

## 打包

打包由 electron-builder 完成, 配置在 `electron-builder.yml`, 产物输出到 `release/`:

```bash
npm run package:win    # Windows: NSIS 安装包
npm run package:mac    # macOS: dmg 与 zip
npm run package:linux  # Linux: AppImage 与 deb
```

每个脚本都会先执行一次 `npm run build`。打包只包含 `dist/electron/`, `dist/renderer/` 与 `package.json`, 以 asar 归档进 `resources/app.asar`, 不携带 `node_modules`。应用图标放在 `build/`, 安装向导与各平台设置见 `electron-builder.yml`。

打包只能在目标平台上产出对应平台的安装包, 例如 Linux 的 AppImage 与 deb 需要 Linux 打包机。产物目录 `release/` 不进入版本追踪, 产物清单与发布注意事项见[发布流程](../release-process/)。

## 文档站

文档站是独立工作区, 不会参与应用打包:

```bash
cd site
npm ci
npm run dev
```

文档内容使用 Markdown, 放在 `site/` 下的目录索引页。提交前执行 `npm run build`。

