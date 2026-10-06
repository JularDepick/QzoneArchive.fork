/**
 * 空间动态直连命令
 *
 * 对应原 Tauri 命令: fetch_first_feeds, fetch_more_feeds
 * 只做凭证注入与命令注册, 请求与重试逻辑在 core/qzoneClient.ts
 */
import { qzoneAuth } from "../core/login.js";
import { fetchFirstFeeds, fetchMoreFeeds, type QzoneFeedCredentials } from "../core/qzoneClient.js";
import { defineCommand } from "../ipc.js";

async function credentials(): Promise<QzoneFeedCredentials> {
  const auth = await qzoneAuth();
  return { uin: auth.uin, gTk: auth.gTk, cookies: auth.cookieHeader, userAgent: auth.userAgent };
}

export function registerQzoneFeedCommands(): void {
  defineCommand("fetch_first_feeds", async () => await fetchFirstFeeds(await credentials()));

  defineCommand("fetch_more_feeds", async (args) => {
    const attachInfo = String(args.attachInfo ?? "");
    return await fetchMoreFeeds(await credentials(), attachInfo);
  });
}
