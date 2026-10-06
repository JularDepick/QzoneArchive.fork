---
title: 发布流程
---

# 发布流程

1. 在功能分支完成一个可审查的变更。
2. 运行应用和文档站的构建检查。
3. 提交使用 Conventional Commits, 例如 `docs: add installation guide`。
4. 使用 PR 模板说明动机, 测试, 风险与关联 Issue。
5. 合并至 `main` 后, 文档工作流会发布 GitHub Pages。

文档部署只使用 `main` 分支的 `website/` 内容。开发或预览中的文档分支不会覆盖公开站点。

## 安装包

安装包由 electron-builder 打包, 配置在 `electron-builder.yml`, 产物输出到 `release/`。三个平台各有独立脚本, 每个脚本都会先执行一次 `npm run build`:

```bash
# Windows: NSIS 安装包
npm run package:win

# macOS: dmg 与 zip
npm run package:mac

# Linux: AppImage 与 deb
npm run package:linux
```

产物命名规则:

| 平台 | 产物 | 说明 |
|:---:|:---:|:---:|
| Windows | `QzoneArchive-<版本>-win-x64-setup.exe` | NSIS 安装包, 另附同名的 `.blockmap` |
| macOS | `QzoneArchive-<版本>-mac-<架构>.dmg` `QzoneArchive-<版本>-mac-<架构>.zip` | 架构取打包主机的架构 |
| Linux | `QzoneArchive-<版本>-linux-<架构>.AppImage` `QzoneArchive-<版本>-linux-<架构>.deb` | 架构取打包主机的架构 |

各平台的安装形态与元数据:

| 平台 | 安装形态 | 元数据 |
|:---:|:---:|:---:|
| Windows | NSIS, 当前用户安装, 不请求管理员权限, 向导语言包含简体中文与英文 | 应用标识 `top.ehre.qzonearchive`, 产品名 `QzoneArchive`, 版本取 `package.json`, 图标 `build/icon.ico` |
| macOS | 磁盘映像与压缩包 | 应用标识 `top.ehre.qzonearchive`, 产品名 `QzoneArchive`, 版本取 `package.json`, 图标 `build/icon.icns`, 分类 Utility |
| Linux | AppImage 与 deb | 应用标识 `top.ehre.qzonearchive`, 产品名 `QzoneArchive`, 版本取 `package.json`, 图标 `build/icons/`, 分类 Utility |

打包只包含 `dist/electron/`, `dist/renderer/` 与 `package.json`, 以 asar 归档进 `resources/app.asar`, 不携带 `node_modules`。产物目录 `release/` 不进入版本追踪。

同一目录下的 `release/win-unpacked/`, 即 macOS 的 `release/mac/` 或 `release/mac-arm64/`, Linux 的 `release/linux-unpacked/`, 是不需要安装即可直接运行的应用目录, 方便本地验证, 也可以随 Release 一起作为免安装版本分发。

应用数据写在可执行文件所在目录的 `data/` 子目录, 因此安装版的数据位于 `%LOCALAPPDATA%\Programs\QzoneArchive\data`, 解包版的数据位于 `release/win-unpacked/data`。升级或重装前建议提醒用户备份该目录。

代码签名与公证尚未配置, 产出的可执行文件与安装包均为未签名状态。分发时需要在 Release 说明中提示用户只从本仓库获取安装包。

从源码构建运行仍然可用:

```bash
npm ci
npm run build
npm start
```
