/** 主进程代发 HTTP 命令, 供渲染进程申请带凭证或跨域的请求 */
import { defineCommand } from "../ipc.js";
import { fetchRemoteBytes, fetchRemoteText } from "../net.js";

/**
 * net.ts 会额外返回 Set-Cookie 与 Location 供主进程内部使用,
 * 这里按 bridge.d.ts 的契约裁剪, 避免响应头随 IPC 外泄
 */
function textContract(result: QzaRemoteFetchTextResult): QzaRemoteFetchTextResult {
  return { ok: result.ok, status: result.status, contentType: result.contentType, text: result.text };
}

function bytesContract(result: QzaRemoteFetchBytesResult): QzaRemoteFetchBytesResult {
  return { ok: result.ok, status: result.status, contentType: result.contentType, bytesBase64: result.bytesBase64 };
}

/**
 * 渲染进程可访问的远程地址范围
 *
 * 对应 1.0.3 的 Tauri 权限清单: 渲染进程的网络访问被限制在空间接口, 头像与图片域名内,
 * 这里沿用同一份清单, 避免渲染进程借主进程发起任意请求
 */
const RENDERER_ALLOWED_HOSTS = ["h5.qzone.qq.com", "q1.qlogo.cn", "qlogo2.store.qq.com", "photovideo.photo.qq.com"];
const RENDERER_ALLOWED_SUFFIXES = [".photo.store.qq.com", ".qpic.cn"];

function assertRendererUrlAllowed(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`地址无效, 无法请求: ${url}`);
  }
  const allowed =
    RENDERER_ALLOWED_HOSTS.includes(host) || RENDERER_ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!allowed) throw new Error(`该地址不在渲染进程可访问的范围内: ${host}`);
}

export function registerNetCommands(): void {
  defineCommand("remote_fetch_text", async (args) => {
    const url = String(args.url ?? "");
    assertRendererUrlAllowed(url);
    return textContract(await fetchRemoteText(url, args.init as QzaRemoteFetchInit | undefined));
  });
  defineCommand("remote_fetch_bytes", async (args) => {
    const url = String(args.url ?? "");
    assertRendererUrlAllowed(url);
    return bytesContract(await fetchRemoteBytes(url, args.init as QzaRemoteFetchInit | undefined));
  });
}
