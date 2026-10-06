/** 文件与系统集成命令: 保存对话框, 写文件, 打开外部链接 */
import { BrowserWindow, dialog, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { defineCommand } from "../ipc.js";
import { dataRoot } from "../paths.js";

/**
 * 由保存对话框授权的写入路径
 *
 * 对应原 Tauri fs 插件的作用域约束: 渲染进程只能写对话框选中的文件或数据根目录内的文件
 */
const grantedWritePaths = new Set<string>();

function resolveWritable(target: string): string {
  const resolved = resolve(target);
  const root = resolve(dataRoot());
  if (resolved === root || resolved.startsWith(root + sep) || grantedWritePaths.has(resolved)) {
    return resolved;
  }
  throw new Error(`写入路径未经授权: ${resolved}`);
}

export function registerFileCommands(): void {
  defineCommand("save_dialog", async (args, event) => {
    const options = args as unknown as QzaSaveDialogOptions;
    const parent = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      defaultPath: options.defaultPath,
      filters: options.filters,
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return null;
    grantedWritePaths.add(resolve(result.filePath));
    return result.filePath;
  });

  defineCommand("write_file", async (args) => {
    const target = String(args.path ?? "");
    if (target.length === 0) throw new Error("写入文件失败: 缺少目标路径");
    const data = args.data;
    if (!(data instanceof Uint8Array)) throw new Error("写入文件失败: 数据必须是字节数组");
    await writeFile(resolveWritable(target), data);
  });

  defineCommand("open_external_url", async (args) => {
    const parsed = new URL(String(args.url ?? ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`只允许打开 http 或 https 链接: ${parsed.toString()}`);
    }
    await shell.openExternal(parsed.toString());
  });
}
