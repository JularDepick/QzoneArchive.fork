/**
 * 命令路由
 *
 * 渲染进程通过 preload 暴露的 invoke 走单一通道 qza:invoke, 命令名沿用原 Tauri 命令名
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";

export const IPC_CHANNEL = "qza:invoke";

export type CommandArgs = Record<string, unknown>;
export type CommandHandler = (args: CommandArgs, event: IpcMainInvokeEvent) => unknown | Promise<unknown>;

const commands = new Map<string, CommandHandler>();

export function defineCommand(name: string, handler: CommandHandler): void {
  if (commands.has(name)) throw new Error(`命令重复注册: ${name}`);
  commands.set(name, handler);
}

export function definedCommands(): string[] {
  return [...commands.keys()].sort();
}

export function installCommandRouter(): void {
  ipcMain.handle(IPC_CHANNEL, async (event, command: unknown, args: unknown) => {
    const name = typeof command === "string" ? command : "";
    const handler = commands.get(name);
    if (!handler) throw new Error(`未注册的命令: ${name}`);
    return await handler((args ?? {}) as CommandArgs, event);
  });
}
