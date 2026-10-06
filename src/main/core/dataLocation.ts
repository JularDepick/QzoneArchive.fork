/**
 * 数据根目录位置解析
 *
 * 设计约束: 用户数据优先放在用户目录下的 .qzonearchive.fork, 便于卸载或重装应用后仍然保留;
 * 该位置不可写时回退到应用所在目录下的同名目录, 两处都不可写则直接报错
 * 本模块不依赖 electron, 开发脚本可以直接复用同一份判定逻辑
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DATA_DIR_NAME = ".qzonearchive.fork";
const WRITE_PROBE_NAME = ".write-probe";

export interface DataLocation {
  root: string;
  /** true 表示首选位置不可写, 实际使用的是应用目录下的回退位置 */
  fallback: boolean;
}

/** 探测目录是否可写, 探测文件用后即删 */
export function directoryIsWritable(target: string): boolean {
  try {
    mkdirSync(target, { recursive: true });
    const probe = join(target, WRITE_PROBE_NAME);
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 依次尝试用户目录与应用目录, 返回实际可用的数据根目录 */
export function resolveDataLocation(appRoot: string, home: string = homedir()): DataLocation {
  const preferred = join(home, DATA_DIR_NAME);
  if (directoryIsWritable(preferred)) return { root: preferred, fallback: false };
  const local = join(appRoot, DATA_DIR_NAME);
  if (directoryIsWritable(local)) return { root: local, fallback: true };
  throw new Error(`数据目录不可写, 无法保存归档: ${preferred} 与 ${local}`);
}
