/**
 * 登录凭证写入窗口会话
 *
 * 二维码登录的凭证只保存在主进程内存中, 依赖登录态的窗口需要显式写入会话才会呈现已登录状态
 * 原 Rust 版对凭证头的每一条执行 set_cookie(.qq.com, /), 这里保持同样的做法
 */
import { session, type Session } from "electron";

export const CREDENTIAL_COOKIE_DOMAIN = ".qq.com";
const CREDENTIAL_COOKIE_URL = "https://qzone.qq.com/";

export interface CredentialCookieTarget {
  session?: Session;
  url?: string;
}

/**
 * 把凭证头里的 Cookie 逐条写入目标会话, 返回成功条数
 *
 * 单条写入失败按原基准忽略, 不影响调用方继续打开窗口
 */
export async function applyCredentialCookies(
  cookieHeader: string,
  target: CredentialCookieTarget = {},
): Promise<number> {
  const store = (target.session ?? session.defaultSession).cookies;
  const url = target.url ?? CREDENTIAL_COOKIE_URL;
  let written = 0;
  for (const entry of cookieHeader.split("; ")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    try {
      await store.set({
        url,
        name: entry.slice(0, separator),
        value: entry.slice(separator + 1),
        domain: CREDENTIAL_COOKIE_DOMAIN,
        path: "/",
      });
      written += 1;
    } catch {
      // 单条 Cookie 写入失败忽略
    }
  }
  return written;
}
