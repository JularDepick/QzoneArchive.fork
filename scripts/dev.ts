/**
 * 开发启动脚本
 *
 * 依次完成: 拉起 Vite 开发服务器 -> 编译主进程与预加载脚本 -> 启动 Electron
 * 由系统 Node 直接运行 TypeScript(依赖 Node 的类型剥离能力), 不需要额外构建步骤
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import { electronLaunchArgs } from "./electronArgs.ts";

const projectRoot = process.cwd();
const DEV_SERVER_PORT = 1420;

function electronBinary(): string {
  const pathFile = join(projectRoot, "node_modules", "electron", "path.txt");
  if (!existsSync(pathFile)) {
    throw new Error("未找到 node_modules/electron/path.txt, 请先执行 npm install");
  }
  return join(projectRoot, "node_modules", "electron", "dist", readFileSync(pathFile, "utf8").trim());
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((settle, fail) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: projectRoot });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? settle() : fail(new Error(`${command} 退出码 ${code}`))));
  });
}

async function main(): Promise<void> {
  const server = await createServer({ mode: "development" });
  await server.listen();
  const devUrl = server.resolvedUrls?.local[0] ?? `http://localhost:${DEV_SERVER_PORT}/`;
  console.log(`[dev] 前端开发服务器: ${devUrl}`);

  await run(process.execPath, [join(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.electron.json"]);

  const electron = spawn(electronBinary(), [".", ...electronLaunchArgs()], {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env, QZA_DEV_SERVER_URL: devUrl },
  });
  const exitCode = await new Promise<number>((settle) => {
    electron.on("exit", (code) => settle(code ?? 0));
  });

  await server.close();
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
