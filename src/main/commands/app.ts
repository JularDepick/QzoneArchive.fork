/** 应用级命令: 版本, 平台, 退出, 窗口与数据目录查询 */
import { app, BrowserWindow } from "electron";
import { defineCommand } from "../ipc.js";
import { appRoot, dataRoot } from "../paths.js";

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, QzaPlatform>> = {
  win32: "windows",
  darwin: "macos",
  linux: "linux",
  android: "android",
};

export function registerAppCommands(): void {
  defineCommand("exit_app", () => {
    app.quit();
  });
  defineCommand("app_version", () => app.getVersion());
  defineCommand("os_platform", () => PLATFORM_NAMES[process.platform] ?? "web");
  defineCommand("app_root", () => appRoot());
  defineCommand("data_root", () => dataRoot());
  defineCommand("window_close", (_args, event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
