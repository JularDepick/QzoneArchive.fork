/**
 * 核心逻辑自检
 *
 * 在普通 Node 下运行, 覆盖游标解析与归档数据库状态层, 不依赖 electron 与渲染进程
 * 运行前需要存在主进程编译产物, 请先执行 npm run build:electron
 * 自检数据写在数据根目录的 tmp 子目录内, 结束后删除
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const workDir = join(projectRoot, "data", "tmp", "selftest");
const databaseFile = join(workDir, "selftest.sqlite3");

interface RawDatabase {
  exec: (sql: string) => void;
  close: () => void;
}

interface ArchiveDbModule {
  openArchiveDatabase: (filePath: string) => RawDatabase;
  loadCheckpoint: (db: RawDatabase, ownerUin: string) => Record<string, unknown> | undefined;
  saveCheckpoint: (db: RawDatabase, ownerUin: string, checkpoint: Record<string, unknown>) => void;
  checkpointIsStale: (checkpoint: Record<string, unknown>, current?: number) => boolean;
  reserveArchivePage: (db: RawDatabase, ownerUin: string, current?: number) => number | undefined;
  recordArchiveSkip: (db: RawDatabase, ownerUin: string, record: Record<string, unknown>) => void;
  countUnresolvedSkips: (db: RawDatabase, ownerUin: string) => number;
  listArchiveSkips: (db: RawDatabase, ownerUin: string) => Record<string, unknown>[];
  resolveArchiveSkip: (db: RawDatabase, id: number, recovered: number) => void;
  clearResolvedArchiveSkips: (db: RawDatabase, ownerUin: string) => number;
  remainingArchivePages: (db: RawDatabase, ownerUin: string) => number;
}

interface FeedCursorModule {
  parseFeedCursor: (cursor: string) => { offset: number; baseTime: number; loadCount: number };
  advanceFeedCursor: (cursor: string, offsetAdvance: number) => string;
  skipProbeOffsets: (firstAdvance: number, maxAdvance?: number) => number[];
}

interface ArchiveQueryModule {
  listArchivedFeeds: (db: never, ownerUin: string, limit: number, offset: number, category: string) => Record<string, unknown>[];
  countArchivedFeeds: (db: never, ownerUin: string, category: string) => number;
  getArchiveOverview: (db: never, ownerUin: string, databaseBytes: number) => Record<string, unknown>;
  getInteractionRanking: (db: never, ownerUin: string, limit: number) => Record<string, unknown>[];
  listInteractors: (db: never, ownerUin: string) => Record<string, unknown>[];
  deleteArchivedFeeds: (db: never, ownerUin: string, ids: number[]) => number;
  clearArchivedFeeds: (db: never, ownerUin: string) => number;
}

/** 与 Rust 自检同一形状的互动记录样例, 用于验证查询层的字段契约 */
function sampleFeed(): Record<string, unknown> {
  return {
    comm: { time: 1700000000, subid: 2, feedskey: "feed-key-1" },
    title: { title: "动态标题" },
    summary: { summary: "互动摘要" },
    userinfo: { user: { uin: "10001", nickname: "我" } },
    original: {
      cell_id: { cellid: "cell-1" },
      cell_comm: { feedskey: "origin-key-1", appid: 311, time: 1699999000 },
      cell_summary: { summary: "原动态正文" },
      cell_userinfo: { user: { uin: "10001", nickname: "我" } },
      cell_pic: {
        picdata: {
          pic: [
            { photourl: { 0: { url: "https://img.example/a-0.jpg" }, 1: { url: "https://img.example/a-1.jpg" } } },
            { photourl: [{ url: "https://img.example/b-0.jpg" }] },
          ],
        },
      },
      cell_video: {
        videourl: "https://v.example/a.mp4",
        coverurl: { 0: { url: "https://v.example/a.jpg" } },
      },
      cell_comment: {
        main_comment: {
          commentid: "c1",
          user: { uin: "20002", nickname: "好友" },
          content: "写得不错",
          date: 1700000100,
          replys: [{ content: "谢谢", user: { uin: "10001", nickname: "我" }, date: 1700000200 }],
        },
        comments: [
          { commentid: "c2", replys: [{ content: "同感", user: { uin: "30003", nickname: "路人" }, date: 1700000300 }] },
        ],
      },
    },
  };
}

/** 留言板记录, appid 334 归入 guestbook 分类 */
function sampleGuestbookFeed(): Record<string, unknown> {
  return {
    comm: { time: 1700001000, subid: 2, feedskey: "feed-key-guest" },
    summary: { summary: "留言内容" },
    userinfo: { user: { uin: "50005", nickname: "访客" } },
    original: {
      cell_id: { cellid: "cell-guest" },
      cell_comm: { feedskey: "334_guest", appid: 334, time: 1700000900 },
      cell_userinfo: { user: { uin: "50005", nickname: "访客" } },
    },
  };
}

/** 他人动态记录, 作者不是归档账号 */
function sampleOtherFeed(): Record<string, unknown> {
  return {
    comm: { time: 1700002000, subid: 2, feedskey: "feed-key-other" },
    summary: { summary: "他人互动" },
    userinfo: { user: { uin: "60006", nickname: "好友" } },
    original: {
      cell_id: { cellid: "cell-other" },
      cell_comm: { feedskey: "origin-key-other", appid: 311, time: 1700001900 },
      cell_userinfo: { user: { uin: "60006", nickname: "好友" } },
    },
  };
}

let checked = 0;

function expectEqual(actual: unknown, expected: unknown, label: string): void {
  checked += 1;
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${label} 不符合预期: 实际 ${actualText}, 预期 ${expectedText}`);
  }
  console.log(`通过: ${label}`);
}

function expectTrue(value: boolean, label: string): void {
  checked += 1;
  if (!value) throw new Error(`${label} 不成立`);
  console.log(`通过: ${label}`);
}

function cleanup(): void {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // 文件仍被占用时忽略, 下次自检会重新覆盖
  }
}

/** 每次自检都从空库开始, 避免上次残留的续传位置影响断言 */
function resetDatabaseFiles(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(databaseFile + suffix, { force: true });
    } catch {
      // 文件不存在或仍被占用时忽略
    }
  }
}

/** 与 Rust 单元测试同一份真实游标 */
const REAL_CURSOR =
  "att=back%5Fserver%5Finfo%3Doffset%253D1168%2526total%253D4%2526basetime%253D1495974154%2526feedsource%253D1&lastrefreshtime=1785906139&lastseparatortime=0&loadcount=77&refresh_id=1785906139&tl=1495974154";

function buildNestedCursor(includeLoadCountInAtt: boolean, includeOuterLoadCount: boolean): string {
  const backend = new URLSearchParams({ offset: "1168", basetime: "1495974154" });
  const attach = new URLSearchParams({ back_server_info: backend.toString() });
  if (includeLoadCountInAtt) attach.append("loadcount", "0");
  const outer = new URLSearchParams({ att: attach.toString(), tl: "1495974154" });
  if (includeOuterLoadCount) outer.append("loadcount", "0");
  return outer.toString();
}

async function checkFeedCursor(): Promise<void> {
  const feedCursor = (await import("../dist/electron/main/core/feedCursor.js")) as FeedCursorModule;

  expectEqual(
    feedCursor.parseFeedCursor(REAL_CURSOR),
    { offset: 1168, baseTime: 1495974154, loadCount: 77 },
    "解析真实嵌套游标",
  );
  expectEqual(
    feedCursor.parseFeedCursor(feedCursor.advanceFeedCursor(REAL_CURSOR, 2)),
    { offset: 1170, baseTime: 1495974154, loadCount: 78 },
    "推进真实嵌套游标",
  );

  const innerLoadCount = buildNestedCursor(true, false);
  const advancedInner = feedCursor.advanceFeedCursor(innerLoadCount, 1);
  expectEqual(
    feedCursor.parseFeedCursor(advancedInner),
    { offset: 1169, baseTime: 1495974154, loadCount: 1 },
    "att 内含 loadcount 时保持原有形状",
  );
  expectTrue(!new URLSearchParams(advancedInner).has("loadcount"), "外层不新增 loadcount");

  const missingLoadCount = buildNestedCursor(false, false);
  expectEqual(feedCursor.parseFeedCursor(missingLoadCount).loadCount, 0, "缺少 loadcount 时默认为 0");
  expectEqual(
    feedCursor.parseFeedCursor(feedCursor.advanceFeedCursor(missingLoadCount, 1)).loadCount,
    1,
    "缺少 loadcount 时补进 att",
  );

  expectEqual(
    feedCursor.skipProbeOffsets(1),
    [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096],
    "探测偏移从 1 开始按幂次推进",
  );
  expectEqual(
    feedCursor.skipProbeOffsets(20),
    [20, 32, 64, 128, 256, 512, 1024, 2048, 4096],
    "探测偏移首个值保留给定值",
  );
}

async function checkArchiveDatabase(): Promise<void> {
  const archiveDb = (await import("../dist/electron/main/core/archiveDb.js")) as ArchiveDbModule;
  const owner = "10001";
  resetDatabaseFiles();
  const db = archiveDb.openArchiveDatabase(databaseFile);
  const base = Math.floor(Date.now() / 1000);
  try {
    expectTrue(archiveDb.loadCheckpoint(db, owner) === undefined, "初始没有续传位置");

    archiveDb.saveCheckpoint(db, owner, { cursor: REAL_CURSOR, pages: 3, fetched: 120, saved: 118 });
    const checkpoint = archiveDb.loadCheckpoint(db, owner) as Record<string, unknown>;
    expectEqual(
      [checkpoint.pages, checkpoint.fetched, checkpoint.saved],
      [3, 120, 118],
      "续传位置与统计写入后可读回",
    );
    expectTrue(
      !archiveDb.checkpointIsStale(checkpoint, Number(checkpoint.updatedAt)),
      "刚写入的游标未过期",
    );
    expectTrue(
      archiveDb.checkpointIsStale(checkpoint, Number(checkpoint.updatedAt) + 600),
      "超过有效期的游标判为过期",
    );

    expectEqual(
      archiveDb.reserveArchivePage(db, owner, base),
      undefined,
      "频率窗口首次占用不触发保护",
    );
    expectEqual(archiveDb.remainingArchivePages(db, owner), 299, "首次占用后剩余 299 页");
    // 直接把窗口计数推到上限, 避免循环三百次
    db.exec(`UPDATE archive_rate_limits SET requested_pages=300 WHERE owner_uin='${owner}'`);
    expectEqual(
      archiveDb.reserveArchivePage(db, owner, base),
      base + 600,
      "达到页数上限时返回解禁时间戳",
    );
    expectEqual(
      archiveDb.reserveArchivePage(db, owner, base + 600),
      undefined,
      "窗口过期后重新计数",
    );

    archiveDb.recordArchiveSkip(db, owner, {
      cursor: REAL_CURSOR,
      resumeCursor: REAL_CURSOR,
      pageNumber: 4,
      cursorOffset: 1168,
      offsetAdvance: 32,
      baseTime: 1495974154,
      error: "接口返回错误",
    });
    expectEqual(archiveDb.countUnresolvedSkips(db, owner), 1, "异常跳过记录写入后可计数");
    const skips = archiveDb.listArchiveSkips(db, owner);
    expectEqual(skips.length, 1, "异常跳过列表长度正确");
    expectEqual(skips[0].offsetAdvance, 32, "异常跳过保留推进偏移");
    expectTrue(skips[0].resolvedAt === null, "新写入的异常跳过未解决");

    archiveDb.resolveArchiveSkip(db, Number(skips[0].id), 5);
    expectEqual(archiveDb.countUnresolvedSkips(db, owner), 0, "解决后未解决计数归零");
    expectEqual(archiveDb.clearResolvedArchiveSkips(db, owner), 1, "清理已解决记录返回删除条数");
  } finally {
    db.close();
  }
}

async function checkArchiveQuery(): Promise<void> {
  const archiveDb = (await import("../dist/electron/main/core/archiveDb.js")) as ArchiveDbModule & {
    saveFeedRows: (db: never, ownerUin: string, feeds: readonly unknown[]) => number;
  };
  const archiveQuery = (await import("../dist/electron/main/core/archiveQuery.js")) as ArchiveQueryModule;
  const owner = "10001";
  resetDatabaseFiles();
  const db = archiveDb.openArchiveDatabase(databaseFile);
  const raw = db as never;
  try {
    const saved = archiveDb.saveFeedRows(raw, owner, [sampleFeed(), sampleGuestbookFeed(), sampleOtherFeed()]);
    expectTrue(saved >= 3, "互动记录落库返回写入条数");

    expectEqual(archiveQuery.countArchivedFeeds(raw, owner, "self"), 1, "本人动态计数");
    expectEqual(archiveQuery.countArchivedFeeds(raw, owner, "guestbook"), 1, "留言计数");
    expectEqual(archiveQuery.countArchivedFeeds(raw, owner, "other"), 1, "好友动态计数");

    const items = archiveQuery.listArchivedFeeds(raw, owner, 100, 0, "self");
    expectEqual(items.length, 1, "本人动态查询返回一条");
    const item = items[0];
    const itemKeys = Object.keys(item).sort().join(",");
    expectEqual(
      itemKeys,
      ["authorName", "authorUin", "cellId", "commentCount", "comments", "content", "id", "likeCount", "likes", "ownerUin", "pictureUrls", "publishedAt", "videoCoverUrl", "videoUrl", "videoUrls"].sort().join(","),
      "动态条目字段名与渲染进程契约一致",
    );
    const comments = item.comments as Record<string, unknown>[];
    expectEqual(comments.length, 1, "单条互动记录聚合出一条主评论");
    expectEqual(comments[0].content, "写得不错", "主评论正文来自 main_comment");
    expectTrue((comments[0].replies as unknown[]).length >= 1, "主评论下的回复被保留");
    expectEqual(
      Object.keys(comments[0]).sort().join(","),
      "content,createdAt,nickname,replies,uin",
      "评论字段名与渲染进程契约一致",
    );
    const pictureUrls = item.pictureUrls as string[];
    const videoUrls = item.videoUrls as string[];
    expectTrue(pictureUrls.length > 0, "图片地址已解析");
    expectTrue(videoUrls.length > 0, "视频地址已解析");
    expectEqual(item.videoUrl, videoUrls[0], "videoUrl 取视频地址首个");

    const overview = archiveQuery.getArchiveOverview(raw, owner, 4096);
    expectEqual(overview.dynamics, 3, "概览统计动态条数");
    expectEqual(overview.databaseBytes, 4096, "概览回传数据库字节数");

    const ranking = archiveQuery.getInteractionRanking(raw, owner, 8);
    expectTrue(ranking.length > 0, "互动排行榜返回记录");
    expectEqual(
      Object.keys(ranking[0]).sort().join(","),
      "comments,interactions,likes,nickname,uin",
      "排行榜字段名与渲染进程契约一致",
    );

    const interactors = archiveQuery.listInteractors(raw, owner);
    expectTrue(interactors.length > 0, "联系人列表返回记录");
    expectEqual(
      Object.keys(interactors[0]).sort().join(","),
      "comments,lastAt,likes,nickname,total,uin",
      "联系人字段名与渲染进程契约一致",
    );

    expectEqual(archiveQuery.deleteArchivedFeeds(raw, owner, [Number(item.id)]), 1, "删除单条动态返回删除条数");
    expectEqual(archiveQuery.countArchivedFeeds(raw, owner, "self"), 0, "删除后本人动态归零");
    expectEqual(archiveQuery.clearArchivedFeeds(raw, owner), 2, "清空归档返回清空的动态条数");
    expectEqual(archiveQuery.countArchivedFeeds(raw, owner, "other"), 0, "清空后好友动态归零");
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(workDir, { recursive: true });
  await checkFeedCursor();
  await checkArchiveDatabase();
  await checkArchiveQuery();
  cleanup();
  console.log(`自检全部通过, 共 ${checked} 项断言`);
}

main().catch((error: unknown) => {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
