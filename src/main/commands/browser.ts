/**
 * QQ 空间浏览器窗口命令, 对应原前端的 WebviewWindow 用法
 *
 * 二维码登录的凭证只存在主进程内存中, 打开窗口前必须写进默认会话, 否则空间页是未登录状态
 */
import { qzoneAuth } from "../core/login.js";
import { defineCommand } from "../ipc.js";
import { applyCredentialCookies } from "../session.js";
import { closeQzoneBrowserWindow, isQzoneBrowserWindowOpen, openQzoneBrowserWindow } from "../windows.js";

/** 把当前登录凭证写进默认会话, 未登录时静默跳过并返回 false */
async function syncCredentialCookies(): Promise<boolean> {
  try {
    const auth = qzoneAuth();
    await applyCredentialCookies(auth.cookieHeader);
    return true;
  } catch {
    return false;
  }
}

export function registerBrowserCommands(): void {
  defineCommand("qzone_browser_open", async (args) => {
    const url = String(args.url ?? "");
    if (url.length === 0) throw new Error("打开 QQ 空间窗口失败: 缺少地址");
    await syncCredentialCookies();
    return await openQzoneBrowserWindow(url);
  });
  defineCommand("qzone_browser_close", () => closeQzoneBrowserWindow());
  defineCommand("qzone_browser_state", () => isQzoneBrowserWindowOpen());
  // 所有窗口共用默认会话, 这里把内存中的凭证同步进会话, 对应原实现的 set_cookie 循环
  defineCommand("sync_cookies_to_webview", async () => {
    await syncCredentialCookies();
  });
}
