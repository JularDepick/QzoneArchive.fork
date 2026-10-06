/**
 * 自定义文件协议 qza://
 *
 * 对应原 Tauri 的 assetProtocol 与 convertFileSrc: 渲染进程通过 qza:// 读取数据根目录内的本地文件
 * 协议只允许访问数据根目录, 防止越权读取任意本地文件
 */
import { net, protocol } from "electron";
import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { dataRoot } from "./paths.js";

export const FILE_SCHEME = "qza";
export const FILE_HOST = "local";

/** 数据根目录内可能出现的媒体类型, Range 响应需要显式给出 */
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeOf(target: string): string {
  return CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
}

/** 由绝对路径构造渲染进程可用的 URL, 与 preload 的 toFileUrl 保持一致 */
export function toFileUrl(absolutePath: string): string {
  return `${FILE_SCHEME}://${FILE_HOST}/${encodeURIComponent(absolutePath)}`;
}

function resolveLocalFile(encodedPath: string): string {
  const root = resolve(dataRoot());
  const target = resolve(decodeURIComponent(encodedPath));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`拒绝访问数据目录以外的文件: ${target}`);
  }
  return target;
}

/** 注册协议特权, 必须在 app ready 之前调用 */
export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

/**
 * 注册协议处理函数, 必须在 app ready 之后调用
 *
 * 视频拖动依赖 Range 请求, 这里显式转发请求头并按需返回 206 片段
 */
export function handleFileScheme(): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== FILE_HOST) return new Response("未知的文件协议主机", { status: 400 });
      const target = resolveLocalFile(url.pathname.replace(/^\//, ""));
      const targetUrl = pathToFileURL(target).toString();

      const range = request.headers.get("range");
      if (range === null) return await net.fetch(targetUrl, { headers: request.headers });

      const stat = statSync(target);
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) return await net.fetch(targetUrl, { headers: request.headers });
      const hasStart = match[1].length > 0;
      const hasEnd = match[2].length > 0;
      const start = hasStart ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      const end = hasEnd && hasStart ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      }
      const stream = createReadStream(target, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": contentTypeOf(target),
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 404 });
    }
  });
}
