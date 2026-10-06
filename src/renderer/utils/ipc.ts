/**
 * 渲染进程访问后端的统一入口
 *
 * 取代原 @tauri-apps/api 与各插件(@tauri-apps/plugin-*) 的调用, 其余业务代码不需要感知运行时差异
 * 在浏览器中直接运行前端(无 Electron)时, 桥接缺失, 相关调用会给出明确错误
 * 桥接契约见 src/shared/bridge.d.ts
 */

const bridge: QzaBridge | undefined = typeof window === "undefined" ? undefined : window.qza;

export const isElectronRuntime = bridge !== undefined;

export function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!bridge) return Promise.reject(new Error(`当前不在 Electron 运行时中, 无法调用命令: ${command}`));
  return bridge.invoke<T>(command, args);
}

export function platform(): QzaPlatform {
  if (bridge) return bridge.platform;
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android/i.test(agent)) return "android";
  if (/iPhone|iPad|iPod/i.test(agent)) return "ios";
  return "web";
}

export function convertFileSrc(absolutePath: string): string {
  return bridge ? bridge.toFileUrl(absolutePath) : absolutePath;
}

export function getVersion(): Promise<string> {
  return invoke<string>("app_version");
}

export function openUrl(url: string): Promise<void> {
  return invoke<void>("open_external_url", { url });
}

export function closeCurrentWindow(): Promise<void> {
  return invoke<void>("window_close");
}

export function save(options: QzaSaveDialogOptions = {}): Promise<string | null> {
  return invoke<string | null>("save_dialog", options as Record<string, unknown>);
}

export function writeFile(path: string, data: Uint8Array): Promise<void> {
  return invoke<void>("write_file", { path, data });
}

export function fetchRemoteText(url: string, init?: QzaRemoteFetchInit): Promise<QzaRemoteFetchTextResult> {
  return invoke<QzaRemoteFetchTextResult>("remote_fetch_text", { url, init });
}

export function fetchRemoteBytes(url: string, init?: QzaRemoteFetchInit): Promise<QzaRemoteFetchBytesResult> {
  return invoke<QzaRemoteFetchBytesResult>("remote_fetch_bytes", { url, init });
}

export function openQzoneBrowserWindow(url: string): Promise<boolean> {
  return invoke<boolean>("qzone_browser_open", { url });
}

export function closeQzoneBrowserWindow(): Promise<boolean> {
  return invoke<boolean>("qzone_browser_close");
}

export function qzoneBrowserWindowOpen(): Promise<boolean> {
  return invoke<boolean>("qzone_browser_state");
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function base64ToDataUrl(base64: string, contentType: string): string {
  return `data:${contentType || "application/octet-stream"};base64,${base64}`;
}
