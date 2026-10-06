/**
 * 预加载脚本
 *
 * 编译为 CommonJS 以便在 sandbox 渲染进程中加载, 只向渲染进程暴露必要能力
 * 桥接契约见 src/shared/bridge.d.ts
 */
import { contextBridge, ipcRenderer } from "electron";

const IPC_CHANNEL = "qza:invoke";

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, QzaPlatform>> = {
  win32: "windows",
  darwin: "macos",
  linux: "linux",
  android: "android",
};

const bridge: QzaBridge = {
  invoke: (command, args) => ipcRenderer.invoke(IPC_CHANNEL, command, args),
  toFileUrl: (absolutePath) => `qza://local/${encodeURIComponent(absolutePath)}`,
  platform: PLATFORM_NAMES[process.platform] ?? "web",
};

contextBridge.exposeInMainWorld("qza", bridge);
