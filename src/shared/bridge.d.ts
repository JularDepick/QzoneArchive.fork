/**
 * 前后端共享的桥接契约
 *
 * 本文件是全局声明文件, 不包含运行时导出, 主进程(ESM), 预加载脚本(CJS)与渲染进程都能直接使用
 * 类型统一使用 Qza 前缀, 避免污染通用命名
 */

/** 与 Tauri 插件 platform() 对齐的平台枚举 */
type QzaPlatform = "windows" | "macos" | "linux" | "android" | "ios" | "web";

/** 主进程代发 HTTP 请求时的可选参数 */
interface QzaRemoteFetchInit {
  method?: string;
  headers?: Record<string, string>;
  /** 请求正文, 表单类 POST 接口使用; 缺省时不带正文 */
  body?: string;
}

interface QzaRemoteFetchTextResult {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
}

interface QzaRemoteFetchBytesResult {
  ok: boolean;
  status: number;
  contentType: string;
  bytesBase64: string;
}

interface QzaSaveDialogFilter {
  name: string;
  extensions: string[];
}

interface QzaSaveDialogOptions {
  defaultPath?: string;
  filters?: QzaSaveDialogFilter[];
}

/** 预加载脚本注入到 window.qza 的桥接接口 */
interface QzaBridge {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  toFileUrl(absolutePath: string): string;
  platform: QzaPlatform;
}

interface Window {
  qza?: QzaBridge;
}
