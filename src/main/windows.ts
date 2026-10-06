/**
 * 窗口管理
 *
 * 设计细节: 主窗口默认尺寸 1180x760, 最小 760x560; QQ 空间浏览器窗口 1000x720
 */
import { BrowserWindow, shell } from "electron";
import { join } from "node:path";

export const MAIN_WINDOW_SIZE = { width: 1180, height: 760, minWidth: 760, minHeight: 560 };
export const QZONE_WINDOW_SIZE = { width: 1000, height: 720, minWidth: 480, minHeight: 500 };

const PRELOAD_FILE = "index.cjs";
const RENDERER_ENTRY = "index.html";

let qzoneBrowserWindow: BrowserWindow | null = null;

function preloadPath(): string {
  return join(import.meta.dirname, "..", "preload", PRELOAD_FILE);
}

function rendererEntry(): string {
  return join(import.meta.dirname, "..", "..", "renderer", RENDERER_ENTRY);
}

function devServerUrl(): string | undefined {
  const url = process.env.QZA_DEV_SERVER_URL;
  return url && url.length > 0 ? url : undefined;
}

function openExternalLinks(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function loadRenderer(window: BrowserWindow): void {
  const devUrl = devServerUrl();
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(rendererEntry());
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...MAIN_WINDOW_SIZE,
    show: false,
    center: true,
    title: "空间归档",
    backgroundColor: "#f5f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => window.show());
  openExternalLinks(window);
  loadRenderer(window);
  return window;
}

export async function openQzoneBrowserWindow(url: string): Promise<boolean> {
  if (qzoneBrowserWindow && !qzoneBrowserWindow.isDestroyed()) {
    qzoneBrowserWindow.focus();
    return false;
  }
  const window = new BrowserWindow({
    ...QZONE_WINDOW_SIZE,
    center: true,
    title: "QQ 空间",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  qzoneBrowserWindow = window;
  window.on("closed", () => {
    qzoneBrowserWindow = null;
  });
  await window.loadURL(url);
  return true;
}

export function closeQzoneBrowserWindow(): boolean {
  if (!qzoneBrowserWindow || qzoneBrowserWindow.isDestroyed()) {
    qzoneBrowserWindow = null;
    return false;
  }
  qzoneBrowserWindow.close();
  qzoneBrowserWindow = null;
  return true;
}

export function isQzoneBrowserWindowOpen(): boolean {
  return qzoneBrowserWindow !== null && !qzoneBrowserWindow.isDestroyed();
}
