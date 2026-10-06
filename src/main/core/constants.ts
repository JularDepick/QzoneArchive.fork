/**
 * 归档引擎设计细节常量
 *
 * 这些值可以在不影响核心功能的前提下调整, 集中在此便于开发者知悉与维护
 * 与 AGENTS.md 设计细节章节的索引性说明对应
 */

/** 频率保护窗口, 单位秒 */
export const ARCHIVE_RATE_WINDOW_SECONDS = 10 * 60;

/** 频率保护窗口内允许请求的最大页数 */
export const ARCHIVE_RATE_PAGE_LIMIT = 300;

/** 分页游标有效期, 单位秒 */
export const ARCHIVE_CURSOR_MAX_AGE_SECONDS = 10 * 60;

/** 异常跳过时单次向前探测的最大偏移推进 */
export const ARCHIVE_SKIP_MAX_OFFSET_ADVANCE = 4096;

/** 归档请求间隔下限与上限, 单位毫秒 */
export const ARCHIVE_INTERVAL_MIN_MS = 2000;
export const ARCHIVE_INTERVAL_MAX_MS = 30000;

/** 归档请求间隔默认值, 单位毫秒 */
export const ARCHIVE_INTERVAL_DEFAULT_MS = 3000;

/** 互动列表接口的单页最大重试次数 */
export const FEED_RESPONSE_ATTEMPTS = 6;

/** 互动列表接口重试的基础退避, 单位毫秒, 第 n 次退避为基础值乘以 2 的 n 减 1 次方 */
export const FEED_RETRY_BASE_DELAY_MS = 1500;

/** 首页失败时的重试次数与退避序列, 单位毫秒 */
export const FIRST_PAGE_RETRY_ATTEMPTS = 3;
export const FIRST_PAGE_RETRY_DELAYS_MS = [3000, 6000];

/** 图片下载并发上限 */
export const IMAGE_DOWNLOAD_CONCURRENCY = 4;

/** 图片缓存上限, 单位字节 */
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;

/** 图片与视频下载的超时, 对应基准的 90 秒与 180 秒 */
export const IMAGE_REQUEST_TIMEOUT_MS = 90_000;
export const VIDEO_REQUEST_TIMEOUT_MS = 180_000;

/** 单页中间件请求的列表条数上限 */
export const FEED_PAGE_SIZE_LIMIT = 200;
