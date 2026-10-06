/**
 * 归档数据库
 *
 * 表结构与查询语义对齐 Rust 版 archive.rs, 是归档引擎与浏览命令共用的存储层
 * 本模块不依赖 electron, 只依赖 node:sqlite, 便于在普通 Node 下自测
 * 若将来需要更换 SQLite 驱动, 改动范围限于本文件
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  asInteger,
  isJsonObject,
  jsonPointer,
  parseFeed,
  stableJsonText,
  textAt,
  tryParseJsonText,
} from "./archiveParser.js";
import {
  ARCHIVE_CURSOR_MAX_AGE_SECONDS,
  ARCHIVE_RATE_PAGE_LIMIT,
  ARCHIVE_RATE_WINDOW_SECONDS,
} from "./constants.js";

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS archive_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_uin TEXT NOT NULL,
  feed_key TEXT NOT NULL,
  cell_id TEXT,
  event_type INTEGER NOT NULL DEFAULT 0,
  event_time INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  content TEXT,
  event_summary TEXT,
  actor_uin TEXT,
  actor_name TEXT,
  original_author_uin TEXT,
  original_author_name TEXT,
  picture_count INTEGER NOT NULL DEFAULT 0,
  pictures_json TEXT,
  video_json TEXT,
  comments_json TEXT,
  raw_json TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  UNIQUE(owner_uin, feed_key)
);
CREATE INDEX IF NOT EXISTS idx_archive_feeds_owner_time
  ON archive_feeds(owner_uin, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_archive_feeds_dynamic_type
  ON archive_feeds(owner_uin, cell_id, event_type);
CREATE TABLE IF NOT EXISTS archive_dynamics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_uin TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  published_at INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  author_uin TEXT,
  author_name TEXT,
  category TEXT NOT NULL DEFAULT '',
  pictures_json TEXT,
  video_json TEXT,
  raw_original_json TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  UNIQUE(owner_uin, cell_id)
);
CREATE INDEX IF NOT EXISTS idx_archive_dynamics_owner_time
  ON archive_dynamics(owner_uin, published_at DESC);
CREATE TABLE IF NOT EXISTS archive_checkpoints (
  owner_uin TEXT PRIMARY KEY,
  attach_info TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS archive_rate_limits (
  owner_uin TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  requested_pages INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS archive_skips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_uin TEXT NOT NULL,
  cursor TEXT NOT NULL,
  resume_cursor TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  cursor_offset INTEGER NOT NULL,
  offset_advance INTEGER NOT NULL,
  base_time INTEGER NOT NULL,
  error TEXT NOT NULL,
  skipped_at INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at INTEGER,
  resolved_at INTEGER,
  recovered_records INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner_uin, cursor_offset, base_time)
);
`;

/** 当前 Unix 时间戳, 单位秒 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface ArchiveCheckpoint {
  cursor: string;
  pages: number;
  fetched: number;
  saved: number;
  updatedAt: number;
}

export interface ArchiveSkipRecord {
  cursor: string;
  resumeCursor: string;
  pageNumber: number;
  cursorOffset: number;
  offsetAdvance: number;
  baseTime: number;
  error: string;
}

export interface ArchiveSkipRow extends ArchiveSkipRecord {
  id: number;
  retryCount: number;
  skippedAt: number;
  lastRetryAt: number | null;
  resolvedAt: number | null;
  recoveredRecords: number;
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: unknown }[];
  return new Set(rows.map((row) => String(row.name ?? "")));
}

function upgradeLegacyColumns(db: DatabaseSync): void {
  const checkpointColumns = tableColumns(db, "archive_checkpoints");
  if (!checkpointColumns.has("pages")) {
    db.exec(
      `ALTER TABLE archive_checkpoints ADD COLUMN pages INTEGER NOT NULL DEFAULT 0;
       ALTER TABLE archive_checkpoints ADD COLUMN fetched INTEGER NOT NULL DEFAULT 0;
       ALTER TABLE archive_checkpoints ADD COLUMN saved INTEGER NOT NULL DEFAULT 0;`,
    );
  }
  const dynamicColumns = tableColumns(db, "archive_dynamics");
  if (!dynamicColumns.has("category")) {
    db.exec("ALTER TABLE archive_dynamics ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  }
}

export function openArchiveDatabase(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);
  db.exec(SCHEMA_SQL);
  upgradeLegacyColumns(db);
  migrateLegacyDynamics(db);
  migrateDynamicCategories(db);
  return db;
}

/**
 * 事务包装
 *
 * node:sqlite 没有 rusqlite 的 transaction 帮手, 这里用显式语句代替
 */
function inTransaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 回滚失败时保留原始异常
    }
    throw error;
  }
}

function statement(db: DatabaseSync, sql: string): StatementSync {
  return db.prepare(sql);
}

export function loadCheckpoint(db: DatabaseSync, ownerUin: string): ArchiveCheckpoint | undefined {
  const row = statement(
    db,
    "SELECT attach_info,pages,fetched,saved,updated_at FROM archive_checkpoints WHERE owner_uin=?",
  ).get(ownerUin) as
    | { attach_info: string; pages: number; fetched: number; saved: number; updated_at: number }
    | undefined;
  if (!row) return undefined;
  const cursor = String(row.attach_info ?? "");
  if (cursor.trim().length === 0) return undefined;
  return {
    cursor,
    pages: Number(row.pages ?? 0),
    fetched: Number(row.fetched ?? 0),
    saved: Number(row.saved ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function saveCheckpoint(
  db: DatabaseSync,
  ownerUin: string,
  checkpoint: { cursor: string; pages: number; fetched: number; saved: number },
): void {
  statement(
    db,
    `INSERT INTO archive_checkpoints(owner_uin,attach_info,pages,fetched,saved,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(owner_uin) DO UPDATE SET
       attach_info=excluded.attach_info,pages=excluded.pages,fetched=excluded.fetched,
       saved=excluded.saved,updated_at=excluded.updated_at`,
  ).run(
    ownerUin,
    checkpoint.cursor,
    checkpoint.pages,
    checkpoint.fetched,
    checkpoint.saved,
    nowSeconds(),
  );
}

export function clearCheckpoint(db: DatabaseSync, ownerUin: string): void {
  statement(db, "DELETE FROM archive_checkpoints WHERE owner_uin=?").run(ownerUin);
}

export function checkpointIsStale(checkpoint: ArchiveCheckpoint, current = nowSeconds()): boolean {
  return current - checkpoint.updatedAt >= ARCHIVE_CURSOR_MAX_AGE_SECONDS;
}

/**
 * 占用一次分页请求额度
 *
 * 返回 undefined 表示可以继续请求; 返回时间戳表示已触发频率保护, 需要等到该时间戳
 */
export function reserveArchivePage(
  db: DatabaseSync,
  ownerUin: string,
  current = nowSeconds(),
): number | undefined {
  const state = statement(
    db,
    "SELECT window_started_at,requested_pages FROM archive_rate_limits WHERE owner_uin=?",
  ).get(ownerUin) as { window_started_at: number; requested_pages: number } | undefined;

  if (!state) {
    statement(
      db,
      "INSERT INTO archive_rate_limits(owner_uin,window_started_at,requested_pages) VALUES (?,?,1)",
    ).run(ownerUin, current);
    return undefined;
  }

  const startedAt = Number(state.window_started_at ?? 0);
  const pages = Number(state.requested_pages ?? 0);
  if (current - startedAt < ARCHIVE_RATE_WINDOW_SECONDS && pages >= ARCHIVE_RATE_PAGE_LIMIT) {
    return startedAt + ARCHIVE_RATE_WINDOW_SECONDS;
  }
  if (current - startedAt >= ARCHIVE_RATE_WINDOW_SECONDS) {
    statement(
      db,
      "UPDATE archive_rate_limits SET window_started_at=?,requested_pages=1 WHERE owner_uin=?",
    ).run(current, ownerUin);
    return undefined;
  }
  statement(
    db,
    "UPDATE archive_rate_limits SET requested_pages=requested_pages+1 WHERE owner_uin=?",
  ).run(ownerUin);
  return undefined;
}

/** 当前频率窗口内剩余可请求页数, 用于前端展示与诊断 */
export function remainingArchivePages(db: DatabaseSync, ownerUin: string): number {
  const state = statement(
    db,
    "SELECT window_started_at,requested_pages FROM archive_rate_limits WHERE owner_uin=?",
  ).get(ownerUin) as { window_started_at: number; requested_pages: number } | undefined;
  if (!state) return ARCHIVE_RATE_PAGE_LIMIT;
  if (nowSeconds() - Number(state.window_started_at ?? 0) >= ARCHIVE_RATE_WINDOW_SECONDS) {
    return ARCHIVE_RATE_PAGE_LIMIT;
  }
  return Math.max(0, ARCHIVE_RATE_PAGE_LIMIT - Number(state.requested_pages ?? 0));
}

export function recordArchiveSkip(
  db: DatabaseSync,
  ownerUin: string,
  record: ArchiveSkipRecord,
): void {
  statement(
    db,
    `INSERT INTO archive_skips
     (owner_uin,cursor,resume_cursor,page_number,cursor_offset,offset_advance,base_time,error,skipped_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(owner_uin,cursor_offset,base_time) DO UPDATE SET
       cursor=excluded.cursor,resume_cursor=excluded.resume_cursor,page_number=excluded.page_number,
       offset_advance=excluded.offset_advance,error=excluded.error,skipped_at=excluded.skipped_at,
       resolved_at=NULL,recovered_records=0`,
  ).run(
    ownerUin,
    record.cursor,
    record.resumeCursor,
    record.pageNumber,
    record.cursorOffset,
    record.offsetAdvance,
    record.baseTime,
    record.error,
    nowSeconds(),
  );
}

export function knownSkipAdvance(
  db: DatabaseSync,
  ownerUin: string,
  cursorOffset: number,
  baseTime: number,
): { offsetAdvance: number; error: string } | undefined {
  const row = statement(
    db,
    `SELECT offset_advance,error FROM archive_skips
     WHERE owner_uin=? AND cursor_offset=? AND base_time=? AND resolved_at IS NULL`,
  ).get(ownerUin, cursorOffset, baseTime) as { offset_advance: number; error: string } | undefined;
  if (!row) return undefined;
  return { offsetAdvance: Number(row.offset_advance ?? 0), error: String(row.error ?? "") };
}

export function countUnresolvedSkips(db: DatabaseSync, ownerUin: string): number {
  const row = statement(
    db,
    "SELECT COUNT(*) AS total FROM archive_skips WHERE owner_uin=? AND resolved_at IS NULL",
  ).get(ownerUin) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

export function listArchiveSkips(db: DatabaseSync, ownerUin: string): ArchiveSkipRow[] {
  const rows = statement(
    db,
    `SELECT id,cursor,resume_cursor,page_number,cursor_offset,offset_advance,base_time,error,
            skipped_at,retry_count,last_retry_at,resolved_at,recovered_records
     FROM archive_skips WHERE owner_uin=? ORDER BY resolved_at IS NOT NULL, skipped_at DESC`,
  ).all(ownerUin) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    cursor: String(row.cursor ?? ""),
    resumeCursor: String(row.resume_cursor ?? ""),
    pageNumber: Number(row.page_number ?? 0),
    cursorOffset: Number(row.cursor_offset ?? 0),
    offsetAdvance: Number(row.offset_advance ?? 0),
    baseTime: Number(row.base_time ?? 0),
    error: String(row.error ?? ""),
    retryCount: Number(row.retry_count ?? 0),
    skippedAt: Number(row.skipped_at ?? 0),
    lastRetryAt: row.last_retry_at === null ? null : Number(row.last_retry_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    recoveredRecords: Number(row.recovered_records ?? 0),
  }));
}

export function resolveArchiveSkip(
  db: DatabaseSync,
  id: number,
  recoveredRecords: number,
): void {
  statement(
    db,
    `UPDATE archive_skips SET resolved_at=?,recovered_records=?,retry_count=retry_count+1,last_retry_at=?
     WHERE id=?`,
  ).run(nowSeconds(), recoveredRecords, nowSeconds(), id);
}

export function markSkipRetryFailed(db: DatabaseSync, id: number): void {
  statement(
    db,
    "UPDATE archive_skips SET retry_count=retry_count+1,last_retry_at=? WHERE id=?",
  ).run(nowSeconds(), id);
}

export function clearResolvedArchiveSkips(db: DatabaseSync, ownerUin: string): number {
  const result = statement(
    db,
    "DELETE FROM archive_skips WHERE owner_uin=? AND resolved_at IS NOT NULL",
  ).run(ownerUin);
  return Number(result.changes ?? 0);
}

/**
 * 旧库原动态迁移
 *
 * 对应 Rust 版 migrate_legacy_dynamics: 动态表为空时由互动记录补建原动态
 */
export function migrateLegacyDynamics(db: DatabaseSync): void {
  const row = statement(db, "SELECT COUNT(*) AS total FROM archive_dynamics").get() as
    | { total: number }
    | undefined;
  if (Number(row?.total ?? 0) > 0) return;
  const feeds = legacyFeedRows(db);
  if (feeds.length === 0) return;
  inTransaction(db, () => {
    for (const [ownerUin, rawJson] of feeds) {
      const feed = tryParseJsonText(rawJson);
      if (feed !== undefined) saveOriginalDynamic(db, ownerUin, feed);
    }
  });
}

/**
 * 旧库分类补全
 *
 * 对应 Rust 版 migrate_dynamic_categories: 存在空分类时重建原动态并回填 self 与 other,
 * 留言分类由 save_original_dynamic 判定, 不在此处覆盖
 */
export function migrateDynamicCategories(db: DatabaseSync): void {
  const row = statement(db, "SELECT COUNT(*) AS total FROM archive_dynamics WHERE category=''").get() as
    | { total: number }
    | undefined;
  if (Number(row?.total ?? 0) === 0) return;
  const feeds = legacyFeedRows(db);
  inTransaction(db, () => {
    for (const [ownerUin, rawJson] of feeds) {
      const feed = tryParseJsonText(rawJson);
      if (feed !== undefined) saveOriginalDynamic(db, ownerUin, feed);
    }
    statement(
      db,
      `UPDATE archive_dynamics SET category=CASE WHEN author_uin=owner_uin THEN 'self' ELSE 'other' END
       WHERE category=''`,
    ).run();
  });
}

/** 迁移用的互动记录行, 只取归属账号与原始 JSON */
function legacyFeedRows(db: DatabaseSync): [string, string][] {
  const rows = statement(db, "SELECT owner_uin,raw_json FROM archive_feeds").all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => [String(row.owner_uin ?? ""), String(row.raw_json ?? "")]);
}

/**
 * 保存单条原动态, 与 Rust 版 save_original_dynamic 对应
 *
 * 缺少 original 或其中没有 cell_id 时跳过; 留言板按 appid 334 或 feedskey 前缀 334_ 判定;
 * 图片与视频在冲突更新时保留库中已有的非空值
 */
export function saveOriginalDynamic(db: DatabaseSync, ownerUin: string, feed: unknown): void {
  if (!isJsonObject(feed) || !Object.hasOwn(feed, "original")) return;
  const original = feed["original"];
  const cellId = textAt(original, "/cell_id/cellid");
  if (cellId === null) return;
  const originalAppid = asInteger(jsonPointer(original, "/cell_comm/appid")) ?? 0;
  const originalKey = textAt(original, "/cell_comm/feedskey") ?? "";
  const isGuestbook = originalAppid === 334 || originalKey.startsWith("334_");
  const publishedAt =
    asInteger(jsonPointer(original, "/cell_comm/time")) ??
    asInteger(jsonPointer(feed, "/comm/time")) ??
    0;
  const content = isGuestbook
    ? textAt(feed, "/summary/summary")
    : textAt(original, "/cell_summary/summary");
  const authorUin = isGuestbook
    ? textAt(feed, "/userinfo/user/uin")
    : textAt(original, "/cell_userinfo/user/uin");
  const authorName = isGuestbook
    ? textAt(feed, "/userinfo/user/nickname")
    : textAt(original, "/cell_userinfo/user/nickname");
  const category = isGuestbook ? "guestbook" : authorUin === ownerUin ? "self" : "other";
  const pictures = jsonPointer(original, "/cell_pic");
  const video = jsonPointer(original, "/cell_video");
  statement(
    db,
    `INSERT INTO archive_dynamics
     (owner_uin,cell_id,published_at,content,author_uin,author_name,category,pictures_json,video_json,raw_original_json,archived_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(owner_uin,cell_id) DO UPDATE SET
      published_at=excluded.published_at,content=excluded.content,author_uin=excluded.author_uin,
      author_name=excluded.author_name,category=excluded.category,
      pictures_json=COALESCE(excluded.pictures_json,archive_dynamics.pictures_json),
      video_json=COALESCE(excluded.video_json,archive_dynamics.video_json),
      raw_original_json=excluded.raw_original_json,archived_at=excluded.archived_at`,
  ).run(
    ownerUin,
    cellId,
    publishedAt,
    content,
    authorUin,
    authorName,
    category,
    pictures === null || pictures === undefined ? null : stableJsonText(pictures),
    video === null || video === undefined ? null : stableJsonText(video),
    stableJsonText(original),
    nowSeconds(),
  );
}

/**
 * 保存一页互动记录, 与 Rust 版 save_feed_rows 对应
 *
 * 返回写入或更新的互动记录条数, 重复归档同一条记录按原基准同样计数
 */
export function saveFeedRows(db: DatabaseSync, ownerUin: string, feeds: readonly unknown[]): number {
  const insert = statement(
    db,
    `INSERT INTO archive_feeds
     (owner_uin, feed_key, cell_id, event_type, event_time, title, content, event_summary,
      actor_uin, actor_name, original_author_uin, original_author_name, picture_count,
      pictures_json, video_json, comments_json, raw_json, archived_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(owner_uin, feed_key) DO UPDATE SET
      cell_id=excluded.cell_id,event_type=excluded.event_type,event_time=excluded.event_time,
      title=excluded.title,content=excluded.content,event_summary=excluded.event_summary,
      actor_uin=excluded.actor_uin,actor_name=excluded.actor_name,
      original_author_uin=excluded.original_author_uin,original_author_name=excluded.original_author_name,
      picture_count=excluded.picture_count,pictures_json=excluded.pictures_json,
      video_json=excluded.video_json,comments_json=excluded.comments_json,
      raw_json=excluded.raw_json,archived_at=excluded.archived_at`,
  );
  let saved = 0;
  for (const feed of feeds) {
    saveOriginalDynamic(db, ownerUin, feed);
    const parsed = parseFeed(feed);
    const result = insert.run(
      ownerUin,
      parsed.feedKey,
      parsed.cellId,
      parsed.eventType,
      parsed.eventTime,
      parsed.title,
      parsed.content,
      parsed.eventSummary,
      parsed.actorUin,
      parsed.actorName,
      parsed.originalAuthorUin,
      parsed.originalAuthorName,
      parsed.pictureCount,
      parsed.picturesJson,
      parsed.videoJson,
      parsed.commentsJson,
      parsed.rawJson,
      nowSeconds(),
    );
    saved += Number(result.changes ?? 0);
  }
  return saved;
}

/**
 * 保存一页并推进续传位置, 与 Rust 版 save_page 对应
 *
 * nextCursor 为 null 时清除续传位置; resetCheckpointStats 为真时页数从 1 重新计
 */
export function savePage(
  db: DatabaseSync,
  ownerUin: string,
  feeds: readonly unknown[],
  nextCursor: string | null,
  resetCheckpointStats: boolean,
): number {
  return inTransaction(db, () => {
    const saved = saveFeedRows(db, ownerUin, feeds);
    if (nextCursor === null) {
      statement(db, "DELETE FROM archive_checkpoints WHERE owner_uin=?").run(ownerUin);
      return saved;
    }
    if (resetCheckpointStats) {
      statement(
        db,
        `INSERT INTO archive_checkpoints(owner_uin,attach_info,pages,fetched,saved,updated_at)
         VALUES (?,?,1,?,?,?)
         ON CONFLICT(owner_uin) DO UPDATE SET attach_info=excluded.attach_info,
          pages=1,fetched=excluded.fetched,saved=excluded.saved,updated_at=excluded.updated_at`,
      ).run(ownerUin, nextCursor, feeds.length, saved, nowSeconds());
      return saved;
    }
    statement(
      db,
      `INSERT INTO archive_checkpoints(owner_uin,attach_info,pages,fetched,saved,updated_at)
       VALUES (?,?,1,?,?,?)
       ON CONFLICT(owner_uin) DO UPDATE SET attach_info=excluded.attach_info,
        pages=archive_checkpoints.pages+1,fetched=archive_checkpoints.fetched+excluded.fetched,
        saved=archive_checkpoints.saved+excluded.saved,updated_at=excluded.updated_at`,
    ).run(ownerUin, nextCursor, feeds.length, saved, nowSeconds());
    return saved;
  });
}

/** 保存找回页, 与 Rust 版 save_retried_page 对应, 不触碰续传位置 */
export function saveRetriedPage(db: DatabaseSync, ownerUin: string, feeds: readonly unknown[]): number {
  return inTransaction(db, () => saveFeedRows(db, ownerUin, feeds));
}

/** 单条异常跳过的重试目标, 与 Rust 版 retry_single_skip 的查询对应 */
export interface ArchiveSkipRetryTarget {
  cursor: string;
  resolvedAt: number | null;
}

/** 取一条异常跳过记录的游标与恢复状态, 不存在时返回 undefined */
export function loadSkipRetryTarget(
  db: DatabaseSync,
  ownerUin: string,
  id: number,
): ArchiveSkipRetryTarget | undefined {
  const row = statement(
    db,
    "SELECT cursor,resolved_at FROM archive_skips WHERE id=? AND owner_uin=?",
  ).get(id, ownerUin) as { cursor: string; resolved_at: number | null } | undefined;
  if (!row) return undefined;
  return {
    cursor: String(row.cursor ?? ""),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
  };
}

/** 待重试的异常跳过标识, 按跳过时间升序, 与 Rust 版批量重试的查询对应 */
export function listPendingSkipIds(db: DatabaseSync, ownerUin: string): number[] {
  const rows = statement(
    db,
    "SELECT id FROM archive_skips WHERE owner_uin=? AND resolved_at IS NULL ORDER BY skipped_at ASC",
  ).all(ownerUin) as Record<string, unknown>[];
  return rows.map((row) => Number(row.id));
}

/** 记录一次成功的找回, 与 Rust 版 retry_single_skip 成功分支的更新对应 */
export function completeSkipRetry(
  db: DatabaseSync,
  ownerUin: string,
  id: number,
  recoveredRecords: number,
  attemptedAt: number,
): void {
  statement(
    db,
    `UPDATE archive_skips SET retry_count=retry_count+1,last_retry_at=?,
      resolved_at=?,recovered_records=? WHERE id=? AND owner_uin=?`,
  ).run(attemptedAt, attemptedAt, recoveredRecords, id, ownerUin);
}

/** 记录一次失败的找回并覆盖错误摘要, 与 Rust 版 retry_single_skip 失败分支的更新对应 */
export function failSkipRetry(
  db: DatabaseSync,
  ownerUin: string,
  id: number,
  error: string,
  attemptedAt: number,
): void {
  statement(
    db,
    "UPDATE archive_skips SET retry_count=retry_count+1,last_retry_at=?,error=? WHERE id=? AND owner_uin=?",
  ).run(attemptedAt, error, id, ownerUin);
}
