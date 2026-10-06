/**
 * 启动自检脚本
 *
 * 以 QZA_SMOKE=1 启动 Electron, 等待其输出运行时报告后退出, 报告同时写入数据目录的 smoke-report.json
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDataLocation } from "../dist/electron/main/core/dataLocation.js";
import { electronLaunchArgs } from "./electronArgs.ts";

const projectRoot = process.cwd();
const reportFile = join(resolveDataLocation(projectRoot).root, "smoke-report.json");
const TIMEOUT_MS = 60_000;

function electronBinary(): string {
  const pathFile = join(projectRoot, "node_modules", "electron", "path.txt");
  if (!existsSync(pathFile)) throw new Error("未找到 node_modules/electron/path.txt, 请先执行 npm install");
  return join(projectRoot, "node_modules", "electron", "dist", readFileSync(pathFile, "utf8").trim());
}

async function main(): Promise<void> {
  const extraArgs = [...electronLaunchArgs(), ...process.argv.slice(2)];
  const child = spawn(electronBinary(), [".", ...extraArgs], {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env, QZA_SMOKE: "1" },
  });

  const timer = setTimeout(() => {
    console.error("[smoke] 自检超时, 结束进程");
    child.kill();
  }, TIMEOUT_MS);

  const exitCode = await new Promise<number>((settle) => {
    child.on("exit", (code) => settle(code ?? 0));
  });
  clearTimeout(timer);

  if (existsSync(reportFile)) {
    console.log(`[smoke] 自检报告: ${readFileSync(reportFile, "utf8")}`);
  } else {
    console.error(`[smoke] 未生成自检报告: ${reportFile}`);
  }
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
