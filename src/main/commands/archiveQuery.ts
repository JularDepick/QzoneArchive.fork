/**
 * 归档浏览展示命令
 *
 * 对应原 Tauri 命令: list_archived_feeds, count_archived_feeds, get_archived_feed,
 * get_archive_overview, get_interaction_ranking, delete_archived_feeds, clear_archived_feeds
 */
import { rmSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openArchiveDatabase } from "../core/archiveDb.js";
import { resetArchiveProgress } from "../core/archiveEngine.js";
import {
  clearArchivedFeeds,
  countArchivedFeeds,
  deleteArchivedFeeds,
  getArchiveOverview,
  getArchivedFeed,
  getInteractionRanking,
  listArchivedFeeds,
  listInteractors,
} from "../core/archiveQuery.js";
import { logoutQzone, qzoneAuth } from "../core/login.js";
import { defineCommand } from "../ipc.js";
import { databaseFile, imagesRoot, videosRoot } from "../paths.js";

/** 归档运行中不允许删除数据, 探针由主进程入口在注册归档引擎后注入 */
let archiveIdleProbe: () => boolean = () => true;

export function setArchiveIdleProbe(probe: () => boolean): void {
  archiveIdleProbe = probe;
}

function ensureArchiveIdle(): void {
  if (!archiveIdleProbe()) throw new Error("归档任务运行时不能删除数据，请先取消任务");
}

function withDatabase<T>(run: (db: DatabaseSync) => T): T {
  const db = openArchiveDatabase(databaseFile());
  try {
    return run(db);
  } finally {
    db.close();
  }
}

async function ownerUin(): Promise<string> {
  const auth = await qzoneAuth();
  return auth.uin;
}

function databaseBytes(): number {
  try {
    return statSync(databaseFile()).size;
  } catch {
    return 0;
  }
}

export function registerArchiveQueryCommands(): void {
  defineCommand("list_archived_feeds", async (args) => {
    const owner = await ownerUin();
    const limit = Number(args.limit ?? 100);
    const offset = Number(args.offset ?? 0);
    const category = String(args.category ?? "self");
    return withDatabase((db) => listArchivedFeeds(db, owner, limit, offset, category));
  });

  defineCommand("count_archived_feeds", async (args) => {
    const owner = await ownerUin();
    const category = String(args.category ?? "self");
    return withDatabase((db) => countArchivedFeeds(db, owner, category));
  });

  defineCommand("get_archived_feed", async (args) => {
    const owner = await ownerUin();
    const id = Number(args.id ?? 0);
    return withDatabase((db) => getArchivedFeed(db, owner, id));
  });

  defineCommand("get_archive_overview", async () => {
    const owner = await ownerUin();
    return withDatabase((db) => getArchiveOverview(db, owner, databaseBytes()));
  });

  defineCommand("get_interaction_ranking", async (args) => {
    const owner = await ownerUin();
    const limit = Number(args.limit ?? 8);
    return withDatabase((db) => getInteractionRanking(db, owner, limit));
  });

  defineCommand("list_interactors", async () => {
    const owner = await ownerUin();
    return withDatabase((db) => listInteractors(db, owner));
  });

  defineCommand("delete_archived_feeds", async (args) => {
    ensureArchiveIdle();
    const owner = await ownerUin();
    const ids = Array.isArray(args.ids) ? args.ids.map((value) => Number(value)) : [];
    return withDatabase((db) => deleteArchivedFeeds(db, owner, ids));
  });

  defineCommand("clear_archived_feeds", async () => {
    ensureArchiveIdle();
    const owner = await ownerUin();
    return withDatabase((db) => clearArchivedFeeds(db, owner));
  });

  defineCommand("delete_all_app_data", () => {
    ensureArchiveIdle();
    logoutQzone();
    const dbFile = databaseFile();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(`${dbFile}${suffix}`, { force: true });
      } catch (error) {
        throw new Error(`删除应用数据库失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      rmSync(videosRoot(), { recursive: true, force: true });
    } catch (error) {
      throw new Error(`删除视频缓存失败：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      rmSync(imagesRoot(), { recursive: true, force: true });
    } catch (error) {
      throw new Error(`删除图片归档失败：${error instanceof Error ? error.message : String(error)}`);
    }
    resetArchiveProgress();
  });
}
