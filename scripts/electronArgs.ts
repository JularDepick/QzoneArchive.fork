/**
 * Electron 启动参数
 *
 * 本机工作目录带 Low 完整性标签时, Chromium 的渲染沙箱初始化会失败并让渲染进程崩溃,
 * 因此开发期默认追加 --no-sandbox; 设置 QZA_SANDBOX=1 可以强制保留沙箱,
 * 打包产物不受这里影响, 仍使用 Electron 默认沙箱配置
 */
export function electronLaunchArgs(): string[] {
  if (process.env.QZA_SANDBOX === "1") return [];
  console.warn("[dev] 已禁用 Chromium 沙箱以满足本机工作目录的完整性限制, 设置 QZA_SANDBOX=1 可恢复");
  return ["--no-sandbox"];
}
