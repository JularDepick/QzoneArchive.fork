/**
 * 启动自检
 *
 * 设置 QZA_SMOKE=1 启动时输出运行时诊断并退出, 用于验证 Electron 外壳, 桥接注入与数据目录约束
 * 超时或加载失败时也会写出报告, 便于定位问题
 */
import { app, BrowserWindow } from "electron";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { definedCommands } from "./ipc.js";
import { appRoot, dataPath, dataRoot } from "./paths.js";

const SMOKE_TIMEOUT_MS = 45_000;
const LOAD_TIMEOUT_MS = 20_000;
const COMMAND_CHECK_TIMEOUT_MS = 15_000;

/** 通过渲染进程桥接真实调用 IPC 的命令自检用例, 只覆盖不依赖网络与交互的命令 */
interface CommandCase {
  command: string;
  args?: Record<string, unknown>;
  expect: "ok" | "error";
  /** expect 为 error 时, 用于确认命令确实进入了业务逻辑而不是未注册 */
  errorIncludes?: string;
}

const COMMAND_CASES: CommandCase[] = [
  { command: "app_version", expect: "ok" },
  { command: "app_root", expect: "ok" },
  { command: "data_root", expect: "ok" },
  { command: "os_platform", expect: "ok" },
  { command: "get_login_status", expect: "ok" },
  { command: "不存在的命令", expect: "error", errorIncludes: "未注册的命令" },
  { command: "get_archive_overview", expect: "error", errorIncludes: "尚未登录" },
  { command: "get_archive_progress", expect: "ok" },
  { command: "fetch_first_feeds", expect: "error", errorIncludes: "尚未登录" },
  { command: "fetch_more_feeds", args: { attachInfo: "" }, expect: "error", errorIncludes: "尚未登录" },
  { command: "list_archive_skips", expect: "error", errorIncludes: "尚未登录" },
  { command: "list_interactors", expect: "error", errorIncludes: "尚未登录" },
  { command: "list_archived_media", args: { limit: 1, offset: 0 }, expect: "error", errorIncludes: "尚未登录" },
  { command: "load_archived_image", args: { id: 1, pictureIndex: 0 }, expect: "error", errorIncludes: "尚未登录" },
  { command: "load_archived_video", args: { id: 1 }, expect: "error", errorIncludes: "尚未登录" },
  { command: "export_archived_html", args: { category: "self" }, expect: "error", errorIncludes: "尚未登录" },
  { command: "check_recycle_password", expect: "ok" },
  { command: "close_recycle_password_window", expect: "ok" },
  { command: "list_recycle_albums", args: { pwd2sig: "smoke" }, expect: "error", errorIncludes: "尚未登录" },
  { command: "list_qzone_albums", expect: "error", errorIncludes: "尚未登录" },
  { command: "create_qzone_album", args: { name: "smoke" }, expect: "error", errorIncludes: "尚未登录" },
  {
    command: "remote_fetch_text",
    args: { url: "https://example.com/" },
    expect: "error",
    errorIncludes: "不在渲染进程可访问的范围内",
  },
  {
    command: "write_file",
    args: { path: "C:\\qza-smoke-unauthorized.txt", data: [1, 2, 3] },
    expect: "error",
    errorIncludes: "写入路径未经授权",
  },
  { command: "sync_cookies_to_webview", expect: "ok" },
  { command: "qzone_browser_state", expect: "ok" },
  {
    command: "list_archived_feeds",
    args: { limit: 1, offset: 0, category: "self" },
    expect: "error",
    errorIncludes: "尚未登录",
  },
];

const WRITE_FILE_CASE = "write_file";
const WRITE_FILE_BYTES = [104, 105];

export async function runSmokeTest(window: BrowserWindow): Promise<void> {
  const report: Record<string, unknown> = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    appRoot: appRoot(),
    dataRoot: dataRoot(),
    commandCount: definedCommands().length,
  };

  try {
    const sqlite = await import("node:sqlite");
    report.nodeSqlite = typeof sqlite.DatabaseSync === "function" ? "available" : "DatabaseSync 缺失";
  } catch (error) {
    report.nodeSqlite = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  const events: string[] = [];
  const record = (name: string) => {
    events.push(name);
    console.log(`[smoke] 事件: ${name}`);
    report.events = events;
  };

  window.webContents.on("did-finish-load", () => record("did-finish-load"));
  window.webContents.on("dom-ready", () => record("dom-ready"));
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    events.push(`did-fail-load ${code} ${description} ${url}`);
    console.error(`[smoke] 加载失败: ${code} ${description} ${url}`);
    report.events = events;
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    events.push(`render-process-gone ${details.reason}`);
    console.error(`[smoke] 渲染进程退出: ${details.reason}`);
    report.events = events;
  });
  window.webContents.on("preload-error", (_event, path, error) => {
    events.push(`preload-error ${path} ${error.message}`);
    console.error(`[smoke] 预加载脚本异常: ${path} ${error.message}`);
    report.events = events;
  });
  window.webContents.on("console-message", (_event, level, message, line, source) => {
    appendFileSync(dataPath("smoke-console.log"), `[${level}] ${source}:${line} ${message}\n`, "utf8");
  });

  let finished = false;
  const writeReport = () => {
    const payload = JSON.stringify(report);
    try {
      writeFileSync(dataPath("smoke-report.json"), payload, "utf8");
    } catch (error) {
      console.error(`[smoke] 写入自检报告失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`[smoke] ${payload}`);
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    writeReport();
    try {
      report.bridge = await Promise.race([
        window.webContents.executeJavaScript(
          "({ invoke: typeof window.qza?.invoke === 'function', platform: window.qza?.platform ?? null, mounted: (document.querySelector('#app')?.childElementCount ?? 0) > 0, title: document.title, location: location.href })",
        ),
        new Promise((settle) => setTimeout(() => settle("桥接检查超时"), 5_000)),
      ]);
    } catch (error) {
      report.bridge = `检查失败: ${error instanceof Error ? error.message : String(error)}`;
    }
    writeReport();
    await runCommandChecks();
    await runProtocolCheck();
    writeReport();
    app.quit();
  };

  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    report.timedOut = true;
    writeReport();
    app.exit(1);
  }, SMOKE_TIMEOUT_MS);

  /** 校验 qza:// 协议能读取数据根目录内的文件, 并检查 Range 请求是否被支持(视频拖动依赖它) */
  const runProtocolCheck = async (): Promise<void> => {
    const rangeFile = dataPath("tmp", "qza-range.bin");
    try {
      writeFileSync(rangeFile, Buffer.from(Array.from({ length: 4096 }, (_value, index) => index % 256)));
    } catch (error) {
      report.protocol = `准备测试文件失败: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    const script = `(async () => {
      const url = "qza://local/" + encodeURIComponent(${JSON.stringify(rangeFile)});
      const full = await fetch(url);
      const fullBytes = new Uint8Array(await full.arrayBuffer());
      const partial = await fetch(url, { headers: { Range: "bytes=10-19" } });
      const partialBytes = new Uint8Array(await partial.arrayBuffer());
      return {
        fullStatus: full.status,
        fullLength: fullBytes.length,
        partialStatus: partial.status,
        partialLength: partialBytes.length,
        partialFirst: partialBytes[0],
        partialLast: partialBytes[partialBytes.length - 1],
      };
    })()`;
    try {
      report.protocol = await Promise.race([
        window.webContents.executeJavaScript(script),
        new Promise((settle) => setTimeout(() => settle("协议检查超时"), COMMAND_CHECK_TIMEOUT_MS)),
      ]);
    } catch (error) {
      report.protocol = `协议检查失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  /** 逐条调用命令并核对成功或失败, 同时校验写文件命令真的落盘 */
  const runCommandChecks = async (): Promise<void> => {
    const target = dataPath("tmp", "smoke-write.txt");
    const cases: CommandCase[] = [
      ...COMMAND_CASES,
      { command: WRITE_FILE_CASE, args: { path: target, data: WRITE_FILE_BYTES }, expect: "ok" },
    ];
    const script = `(async () => {
      const cases = ${JSON.stringify(cases)};
      const results = [];
      for (const item of cases) {
        const args = item.args ? { ...item.args } : undefined;
        if (args && Array.isArray(args.data)) args.data = new Uint8Array(args.data);
        try {
          const value = await window.qza.invoke(item.command, args);
          results.push({ command: item.command, ok: true, expect: item.expect, errorIncludes: item.errorIncludes, value: typeof value === "object" ? JSON.stringify(value).slice(0, 160) : String(value) });
        } catch (error) {
          results.push({ command: item.command, ok: false, expect: item.expect, errorIncludes: item.errorIncludes, error: String((error && error.message) || error).slice(0, 200) });
        }
      }
      return results;
    })()`;
    try {
      const results = (await Promise.race([
        window.webContents.executeJavaScript(script),
        new Promise((settle) => setTimeout(() => settle("命令自检超时"), COMMAND_CHECK_TIMEOUT_MS)),
      ])) as { command: string; ok: boolean; expect: string; errorIncludes?: string; value?: string; error?: string }[] | string;
      if (typeof results === "string") {
        report.commandChecks = results;
        return;
      }
      const failures = results
        .filter((item) => {
          if ((item.expect === "ok") !== item.ok) return true;
          if (item.expect === "error" && item.errorIncludes) {
            return !String(item.error ?? "").includes(item.errorIncludes);
          }
          return false;
        })
        .map((item) => item.command);
      report.commandChecks = { total: results.length, failures, results };
      let written: string | null = null;
      try {
        written = readFileSync(target, "utf8");
      } catch {
        written = null;
      }
      report.writtenFile = written === null ? "未写入" : written === String.fromCharCode(...WRITE_FILE_BYTES) ? "内容一致" : `内容不一致: ${written}`;
      if (failures.length > 0 || report.writtenFile !== "内容一致") {
        console.error(`[smoke] 命令自检未通过: 失败命令 ${failures.join(",") || "无"}, 写文件 ${String(report.writtenFile)}`);
      }
    } catch (error) {
      report.commandChecks = `命令自检失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", () => void finish());
    window.webContents.once("did-fail-load", () => void finish());
    setTimeout(() => {
      if (!finished) {
        report.loadStalled = true;
        void finish();
      }
    }, LOAD_TIMEOUT_MS);
  } else {
    void finish();
  }
}
