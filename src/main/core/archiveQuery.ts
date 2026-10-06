/**
 * 归档浏览查询层
 *
 * 与 Rust 版 archive.rs 的 list_archived_feeds, count_archived_feeds, get_archived_feed,
 * get_archive_overview, get_interaction_ranking, delete_archived_feeds, clear_archived_feeds 对齐
 * 本模块不依赖 electron, 数据库句柄由命令层注入
 */
import type { DatabaseSync } from "node:sqlite";
import {
  commentFromValues,
  mergeComments,
  pictureUrls,
  validateCategory,
  videoCoverUrl,
  videoUrls,
  type ArchiveComment,
} from "./archiveParser.js";

export type ArchiveCategory = "self" | "other" | "guestbook";

export interface ArchiveLikeUser {
  uin: string | null;
  nickname: string | null;
}

/** 输出给渲染进程的评论形状, 与原基准一致地不带 commentId */
export interface ArchiveCommentOutput {
  uin: string | null;
  nickname: string | null;
  content: string;
  createdAt: number;
  replies: ArchiveComment["replies"];
}

export interface ArchiveFeedItem {
  id: number;
  ownerUin: string;
  cellId: string;
  publishedAt: number;
  content: string | null;
  authorUin: string | null;
  authorName: string | null;
  pictureUrls: string[];
  videoUrl: string | null;
  videoUrls: string[];
  videoCoverUrl: string | null;
  likeCount: number;
  commentCount: number;
  likes: ArchiveLikeUser[];
  comments: ArchiveCommentOutput[];
}

export interface ArchiveOverview {
  dynamics: number;
  pictures: number;
  comments: number;
  likes: number;
  databaseBytes: number;
}

export interface InteractionRank {
  uin: string;
  nickname: string;
  interactions: number;
  likes: number;
  comments: number;
}

export interface Interactor {
  uin: string;
  nickname: string;
  total: number;
  likes: number;
  comments: number;
  lastAt: number;
}

export const FEED_PAGE_SIZE_LIMIT = 200;
export const RANKING_LIMIT = 50;
export const DELETE_BATCH_LIMIT = 500;

/** 动态查询列, 与原基准的列顺序保持一致并显式取别名 */
const FEED_COLUMNS = `d.id AS id,d.owner_uin AS owner_uin,d.cell_id AS cell_id,d.published_at AS published_at,
  d.content AS content,d.author_uin AS author_uin,d.author_name AS author_name,
  d.pictures_json AS pictures_json,d.video_json AS video_json,
  (SELECT COUNT(*) FROM archive_feeds f WHERE f.owner_uin=d.owner_uin AND f.cell_id=d.cell_id AND f.event_type=217) AS like_count,
  (SELECT COUNT(*) FROM archive_feeds f WHERE f.owner_uin=d.owner_uin AND f.cell_id=d.cell_id AND f.event_type IN (2,311)) AS comment_count`;

const COMMENTS_SQL = `SELECT comments_json,actor_uin,actor_name,event_summary,event_time FROM archive_feeds
  WHERE owner_uin=? AND cell_id=? AND event_type IN (2,311) ORDER BY event_time ASC`;

const LIKES_SQL = `SELECT actor_uin,actor_name FROM archive_feeds
  WHERE owner_uin=? AND cell_id=? AND event_type=217 ORDER BY event_time ASC`;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** 把评论整理为渲染进程契约的形状, 去掉仅用于聚合去重的 commentId */
function toCommentOutput(comment: ArchiveComment): ArchiveCommentOutput {
  return {
    uin: comment.uin,
    nickname: comment.nickname,
    content: comment.content,
    createdAt: comment.createdAt,
    replies: comment.replies,
  };
}

function rowToItem(row: Record<string, unknown>): ArchiveFeedItem {
  const videoJson = text(row.video_json);
  const urls = videoUrls(videoJson);
  return {
    id: integer(row.id),
    ownerUin: String(row.owner_uin ?? ""),
    cellId: String(row.cell_id ?? ""),
    publishedAt: integer(row.published_at),
    content: text(row.content),
    authorUin: text(row.author_uin),
    authorName: text(row.author_name),
    pictureUrls: pictureUrls(text(row.pictures_json)),
    videoUrl: urls.length > 0 ? urls[0] : null,
    videoUrls: urls,
    videoCoverUrl: videoCoverUrl(videoJson),
    likeCount: integer(row.like_count),
    commentCount: integer(row.comment_count),
    likes: [],
    comments: [],
  };
}

/** 补齐单条动态的评论与点赞, 与原基准按 cell_id 二次查询的行为一致 */
function attachInteractions(db: DatabaseSync, item: ArchiveFeedItem): void {
  const commentRows = db.prepare(COMMENTS_SQL).all(item.ownerUin, item.cellId) as Record<string, unknown>[];
  item.comments = mergeComments(
    commentRows.map((row) =>
      commentFromValues(
        text(row.comments_json),
        text(row.actor_uin),
        text(row.actor_name),
        text(row.event_summary),
        integer(row.event_time),
      ),
    ),
  ).map(toCommentOutput);
  const likeRows = db.prepare(LIKES_SQL).all(item.ownerUin, item.cellId) as Record<string, unknown>[];
  item.likes = likeRows.map((row) => ({
    uin: text(row.actor_uin),
    nickname: text(row.actor_name),
  }));
}

export function listArchivedFeeds(
  db: DatabaseSync,
  ownerUin: string,
  limit: number,
  offset: number,
  category: string,
): ArchiveFeedItem[] {
  validateCategory(category);
  const rows = db
    .prepare(
      `SELECT ${FEED_COLUMNS} FROM archive_dynamics d
       WHERE d.owner_uin=? AND d.category=? ORDER BY d.published_at ASC LIMIT ? OFFSET ?`,
    )
    .all(ownerUin, category, Math.min(Math.max(1, Math.trunc(limit)), FEED_PAGE_SIZE_LIMIT), Math.max(0, Math.trunc(offset))) as Record<string, unknown>[];
  const items = rows.map(rowToItem);
  for (const item of items) attachInteractions(db, item);
  return items;
}

export function getArchivedFeed(db: DatabaseSync, ownerUin: string, id: number): ArchiveFeedItem {
  const row = db
    .prepare(`SELECT ${FEED_COLUMNS} FROM archive_dynamics d WHERE d.owner_uin=? AND d.id=?`)
    .get(ownerUin, Math.trunc(id)) as Record<string, unknown> | undefined;
  if (!row) throw new Error("原始动态不存在或已删除");
  const item = rowToItem(row);
  attachInteractions(db, item);
  return item;
}

export function countArchivedFeeds(db: DatabaseSync, ownerUin: string, category: string): number {
  validateCategory(category);
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM archive_dynamics WHERE owner_uin=? AND category=?")
    .get(ownerUin, category) as { total?: number } | undefined;
  return Math.max(0, integer(row?.total));
}

export function getArchiveOverview(
  db: DatabaseSync,
  ownerUin: string,
  databaseBytes: number,
): ArchiveOverview {
  const dynamicsRow = db
    .prepare("SELECT COUNT(*) AS total FROM archive_dynamics WHERE owner_uin=?")
    .get(ownerUin) as { total?: number } | undefined;
  const interactionRow = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN event_type=217 THEN 1 ELSE 0 END),0) AS likes,
              COALESCE(SUM(CASE WHEN event_type IN (2,311) THEN 1 ELSE 0 END),0) AS comments
       FROM archive_feeds WHERE owner_uin=?`,
    )
    .get(ownerUin) as { likes?: number; comments?: number } | undefined;
  const pictureRows = db
    .prepare("SELECT pictures_json FROM archive_dynamics WHERE owner_uin=? AND pictures_json IS NOT NULL")
    .all(ownerUin) as Record<string, unknown>[];
  let pictures = 0;
  for (const row of pictureRows) pictures += pictureUrls(text(row.pictures_json)).length;
  return {
    dynamics: Math.max(0, integer(dynamicsRow?.total)),
    pictures,
    comments: Math.max(0, integer(interactionRow?.comments)),
    likes: Math.max(0, integer(interactionRow?.likes)),
    databaseBytes: Math.max(0, Math.trunc(databaseBytes)),
  };
}

export function getInteractionRanking(db: DatabaseSync, ownerUin: string, limit: number): InteractionRank[] {
  const rows = db
    .prepare(
      `SELECT actor_uin AS uin,COALESCE(MAX(NULLIF(actor_name,'')),actor_uin) AS nickname,COUNT(*) AS interactions,
              SUM(CASE WHEN event_type=217 THEN 1 ELSE 0 END) AS likes,
              SUM(CASE WHEN event_type IN (2,311) THEN 1 ELSE 0 END) AS comments
       FROM archive_feeds
       WHERE owner_uin=? AND actor_uin IS NOT NULL AND actor_uin<>'' AND actor_uin<>?
         AND event_type IN (2,217,311)
       GROUP BY actor_uin
       ORDER BY COUNT(*) DESC,MAX(event_time) DESC
       LIMIT ?`,
    )
    .all(ownerUin, ownerUin, Math.min(Math.max(1, Math.trunc(limit)), RANKING_LIMIT)) as Record<string, unknown>[];
  return rows.map((row) => ({
    uin: String(row.uin ?? ""),
    nickname: String(row.nickname ?? ""),
    interactions: Math.max(0, integer(row.interactions)),
    likes: Math.max(0, integer(row.likes)),
    comments: Math.max(0, integer(row.comments)),
  }));
}

/** 联系人列表: 按互动次数倒序, 只统计点赞与评论两类互动 */
export function listInteractors(db: DatabaseSync, ownerUin: string): Interactor[] {
  const rows = db
    .prepare(
      `SELECT actor_uin AS uin,COALESCE(MAX(NULLIF(actor_name,'')),actor_uin) AS nickname,
              COUNT(*) AS total,
              SUM(CASE WHEN event_type=217 THEN 1 ELSE 0 END) AS likes,
              SUM(CASE WHEN event_type IN (2,311) THEN 1 ELSE 0 END) AS comments,
              MAX(event_time) AS last_at
       FROM archive_feeds
       WHERE owner_uin=? AND actor_uin IS NOT NULL AND actor_uin<>'' AND actor_uin<>?
         AND event_type IN (2,217,311)
       GROUP BY actor_uin
       ORDER BY COUNT(*) DESC`,
    )
    .all(ownerUin, ownerUin) as Record<string, unknown>[];
  return rows.map((row) => ({
    uin: String(row.uin ?? ""),
    nickname: String(row.nickname ?? ""),
    total: Math.max(0, integer(row.total)),
    likes: Math.max(0, integer(row.likes)),
    comments: Math.max(0, integer(row.comments)),
    lastAt: integer(row.last_at),
  }));
}

/** 删除若干条动态及其互动记录, 返回删除的动态条数 */
export function deleteArchivedFeeds(db: DatabaseSync, ownerUin: string, ids: number[]): number {
  if (ids.length === 0) return 0;
  if (ids.length > DELETE_BATCH_LIMIT) throw new Error(`单次最多删除 ${DELETE_BATCH_LIMIT} 条归档记录`);
  db.exec("BEGIN");
  let count = 0;
  try {
    const deleteFeeds = db.prepare(
      `DELETE FROM archive_feeds WHERE owner_uin=?
       AND cell_id=(SELECT cell_id FROM archive_dynamics WHERE id=? AND owner_uin=?)`,
    );
    const deleteDynamic = db.prepare("DELETE FROM archive_dynamics WHERE id=? AND owner_uin=?");
    for (const id of ids) {
      const numericId = Math.trunc(id);
      deleteFeeds.run(ownerUin, numericId, ownerUin);
      const result = deleteDynamic.run(numericId, ownerUin);
      count += Number(result.changes ?? 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error instanceof Error ? error : new Error(String(error));
  }
  return count;
}

/** 清空某个账号的归档数据与续传, 频率记录, 返回清空的动态条数 */
export function clearArchivedFeeds(db: DatabaseSync, ownerUin: string): number {
  db.exec("BEGIN");
  try {
    const dynamics = Number(
      (db.prepare("DELETE FROM archive_dynamics WHERE owner_uin=?").run(ownerUin) as { changes?: number })
        .changes ?? 0,
    );
    db.prepare("DELETE FROM archive_feeds WHERE owner_uin=?").run(ownerUin);
    db.prepare("DELETE FROM archive_checkpoints WHERE owner_uin=?").run(ownerUin);
    db.prepare("DELETE FROM archive_rate_limits WHERE owner_uin=?").run(ownerUin);
    db.exec("COMMIT");
    return dynamics;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error instanceof Error ? error : new Error(String(error));
  }
}
