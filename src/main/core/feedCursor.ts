/**
 * 互动列表分页游标解析与推进
 *
 * 游标是三层嵌套的查询串: 外层包含 att, att 内含 back_server_info, back_server_info 内含 offset 与 basetime
 * 行为对齐 Rust 版 archive.rs 的 parse_feed_cursor 与 advance_feed_cursor
 */

import { ARCHIVE_SKIP_MAX_OFFSET_ADVANCE } from "./constants.js";

export interface FeedCursorDetails {
  offset: number;
  baseTime: number;
  loadCount: number;
}

type QueryPair = [string, string];

function parseQueryPairs(value: string): QueryPair[] {
  const params = new URLSearchParams(value);
  const pairs: QueryPair[] = [];
  for (const [key, item] of params.entries()) pairs.push([key, item]);
  return pairs;
}

function serializeQueryPairs(pairs: QueryPair[]): string {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params.toString();
}

function pairValue(pairs: QueryPair[], key: string): string | undefined {
  return pairs.find(([candidate]) => candidate === key)?.[1];
}

function setPairValue(pairs: QueryPair[], key: string, value: string): void {
  const pair = pairs.find(([candidate]) => candidate === key);
  if (!pair) throw new Error(`分页游标缺少 ${key}`);
  pair[1] = value;
}

function setOrAppendPairValue(pairs: QueryPair[], key: string, value: string): void {
  const pair = pairs.find(([candidate]) => candidate === key);
  if (pair) pair[1] = value;
  else pairs.push([key, value]);
}

function parseNumber(pairs: QueryPair[], key: string): number {
  const raw = pairValue(pairs, key);
  if (raw === undefined) throw new Error(`分页游标缺少 ${key}`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`分页游标中的 ${key} 不是有效数字`);
  return Math.trunc(value);
}

export function parseFeedCursor(cursor: string): FeedCursorDetails {
  const outer = parseQueryPairs(cursor);
  const attachRaw = pairValue(outer, "att");
  if (attachRaw === undefined) throw new Error("分页游标缺少 att");
  const attach = parseQueryPairs(attachRaw);
  const backendRaw = pairValue(attach, "back_server_info");
  if (backendRaw === undefined) throw new Error("分页游标缺少 back_server_info");
  const backend = parseQueryPairs(backendRaw);
  const loadCountRaw = pairValue(outer, "loadcount") ?? pairValue(attach, "loadcount");
  let loadCount = 0;
  if (loadCountRaw !== undefined) {
    const parsed = Number(loadCountRaw);
    if (!Number.isFinite(parsed)) throw new Error("分页游标中的 loadcount 不是有效数字");
    loadCount = Math.trunc(parsed);
  }
  return {
    offset: parseNumber(backend, "offset"),
    baseTime: parseNumber(backend, "basetime"),
    loadCount,
  };
}

export function advanceFeedCursor(cursor: string, offsetAdvance: number): string {
  if (offsetAdvance <= 0) throw new Error("跳过偏移量必须大于 0");
  const details = parseFeedCursor(cursor);
  const outer = parseQueryPairs(cursor);
  const attachRaw = pairValue(outer, "att");
  if (attachRaw === undefined) throw new Error("分页游标缺少 att");
  const attach = parseQueryPairs(attachRaw);
  const backendRaw = pairValue(attach, "back_server_info");
  if (backendRaw === undefined) throw new Error("分页游标缺少 back_server_info");
  const backend = parseQueryPairs(backendRaw);
  const loadCountInOuter = pairValue(outer, "loadcount") !== undefined;

  setPairValue(backend, "offset", String(details.offset + offsetAdvance));
  setPairValue(attach, "back_server_info", serializeQueryPairs(backend));
  if (!loadCountInOuter) setOrAppendPairValue(attach, "loadcount", String(details.loadCount + 1));
  setPairValue(outer, "att", serializeQueryPairs(attach));
  if (loadCountInOuter) setPairValue(outer, "loadcount", String(details.loadCount + 1));
  return serializeQueryPairs(outer);
}

/**
 * 异常页向前探测的偏移序列
 *
 * 首个偏移取给定值, 其后按 2 的幂次推进, 末尾固定补上最大推进上限
 */
export function skipProbeOffsets(
  firstAdvance: number,
  maxAdvance: number = ARCHIVE_SKIP_MAX_OFFSET_ADVANCE,
): number[] {
  const first = Math.min(Math.max(1, Math.trunc(firstAdvance)), maxAdvance);
  const offsets = [first];
  let candidate = 1;
  while (candidate <= first && candidate < maxAdvance) candidate *= 2;
  while (candidate < maxAdvance) {
    offsets.push(candidate);
    candidate *= 2;
  }
  if (offsets[offsets.length - 1] !== maxAdvance) offsets.push(maxAdvance);
  return offsets;
}
