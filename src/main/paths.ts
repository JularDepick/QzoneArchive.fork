/**
 * 运行时路径解析
 *
 * 设计约束: 应用产生的数据优先落在用户目录下的 .qzonearchive.fork;
 * 该位置无写权限时自动回退到应用所在目录下的同名目录, 两处都不可写则直接报错
 * 数据根目录名与子目录名集中在此定义, 便于开发者调整
 */
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DATA_DIR_NAME, resolveDataLocation } from "./core/dataLocation.js";

type RuntimePathName = Parameters<typeof app.setPath>[0];

export { DATA_DIR_NAME };
export const DATABASE_FILE_NAME = "qzone-archive.sqlite3";
export const IMAGE_DIR_NAME = "images";
export const VIDEO_DIR_NAME = "videos";

/** Electron 与 Chromium 自身的落盘位置, 全部收进数据根目录 */
const RUNTIME_PATH_TARGETS: [RuntimePathName, string][] = [
  ["userData", "runtime"],
  ["sessionData", "runtime"],
  ["logs", "logs"],
  ["crashDumps", "crash"],
  ["temp", "tmp"],
];

/** 应用根目录: 开发时为仓库根目录, 打包后为可执行文件所在目录 */
export function appRoot(): string {
  return app.isPackaged ? dirname(app.getPath("exe")) : app.getAppPath();
}

function assertInside(root: string, target: string): string {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + sep)) {
    throw new Error(`路径越界, 数据只允许落在数据根目录内: ${normalizedTarget}`);
  }
  return normalizedTarget;
}

let cachedRoot: string | null = null;

/**
 * 数据根目录
 *
 * 可用环境变量 QZA_DATA_DIR 显式指定; 未指定时优先用户目录, 无写权限则回退应用目录
 */
export function dataRoot(): string {
  if (cachedRoot === null) {
    const override = process.env.QZA_DATA_DIR;
    cachedRoot =
      override && override.length > 0 ? resolve(override) : resolveDataLocation(appRoot()).root;
  }
  return cachedRoot;
}

/** 数据根目录下的相对路径, 越界即抛错 */
export function dataPath(...segments: string[]): string {
  return assertInside(dataRoot(), join(dataRoot(), ...segments));
}

export function ensureDirectory(target: string): string {
  mkdirSync(target, { recursive: true });
  return target;
}

/** 归档数据库文件路径 */
export function databaseFile(): string {
  return join(ensureDirectory(dataRoot()), DATABASE_FILE_NAME);
}

/** 图片归档目录 */
export function imageDirectory(uin: string): string {
  return ensureDirectory(dataPath(IMAGE_DIR_NAME, uin));
}

/** 图片归档根目录, 所有账号共用, 删除全部数据时整目录清理 */
export function imagesRoot(): string {
  return dataPath(IMAGE_DIR_NAME);
}

/** 视频缓存根目录, 删除全部数据时整目录清理 */
export function videosRoot(): string {
  return dataPath(VIDEO_DIR_NAME);
}

/** 视频缓存目录 */
export function videoDirectory(): string {
  return ensureDirectory(dataPath(VIDEO_DIR_NAME));
}

/** 把 Electron 与 Chromium 自身的落盘位置重定向到数据根目录, 必须在 app ready 之前调用 */
export function redirectElectronPaths(): void {
  for (const [name, folder] of RUNTIME_PATH_TARGETS) {
    app.setPath(name, ensureDirectory(dataPath(folder)));
  }
}
