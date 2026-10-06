/**
 * 主进程 HTTP 客户端
 *
 * 登录凭证只保存在主进程内存中, 因此渲染进程不直接发起需要凭证的请求, 统一经由此处代发
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 请求侧可选项
 *
 * QQ 登录的 check_sig 等接口把凭证放在 302 响应上, 自动跟随跳转会丢掉这些 Set-Cookie,
 * 因此登录流程统一传 manual, 其余调用方沿用默认的 follow
 * 媒体下载这类大文件需要更长的超时, 由调用方显式指定
 */
export interface RemoteRequestOptions {
  redirect?: "follow" | "manual";
  timeoutMs?: number;
  /** 允许的最大响应体字节数, 超出时在读取正文之前放弃请求 */
  maxBytes?: number;
}

/** 响应侧附加信息, 只供主进程内部使用, IPC 命令层会剥掉这两个字段 */
export interface RemoteResponseDetails {
  setCookie: string[];
  location: string;
}

async function request(url: string, init?: QzaRemoteFetchInit, options?: RemoteRequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      redirect: options?.redirect ?? "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 逐条读取 Set-Cookie 与 Location, 由调用方决定如何合并 Cookie */
function responseDetails(response: Response): RemoteResponseDetails {
  return {
    setCookie: response.headers.getSetCookie(),
    location: response.headers.get("location") ?? "",
  };
}

/** QQ 空间部分旧接口仍以 GBK/GB18030 返回中文内容 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

export async function fetchRemoteText(
  url: string,
  init?: QzaRemoteFetchInit,
  options?: RemoteRequestOptions,
): Promise<QzaRemoteFetchTextResult & RemoteResponseDetails> {
  const response = await request(url, init, options);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text: decodeText(bytes),
    ...responseDetails(response),
  };
}

export async function fetchRemoteBytes(
  url: string,
  init?: QzaRemoteFetchInit,
  options?: RemoteRequestOptions,
): Promise<QzaRemoteFetchBytesResult & RemoteResponseDetails & { tooLarge?: boolean }> {
  const response = await request(url, init, options);
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (options?.maxBytes !== undefined && Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body?.cancel();
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytesBase64: "",
      tooLarge: true,
      ...responseDetails(response),
    };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (options?.maxBytes !== undefined && bytes.length > options.maxBytes) {
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytesBase64: "",
      tooLarge: true,
      ...responseDetails(response),
    };
  }
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytesBase64: Buffer.from(bytes).toString("base64"),
    ...responseDetails(response),
  };
}
