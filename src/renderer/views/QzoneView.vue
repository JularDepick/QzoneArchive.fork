<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { closeQzoneBrowserWindow, openQzoneBrowserWindow, openUrl, platform, qzoneBrowserWindowOpen } from "../utils/ipc";
import Button from "primevue/button";
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();
const windowOpen = ref(false);
/** 窗口开合状态轮询间隔, 对应原实现监听窗口销毁事件的行为 */
const WINDOW_STATE_INTERVAL_MS = 1500;
let stateTimer: number | undefined;

function qzoneUrl() {
  const uin = authStore.user?.uin;
  if (platform() === "android") {
    return uin ? `https://m.qzone.qq.com/${uin}` : "https://m.qzone.qq.com";
  }
  return uin ? `https://user.qzone.qq.com/${uin}` : "https://user.qzone.qq.com";
}

async function openQzoneWindow() {
  try {
    await openQzoneBrowserWindow(qzoneUrl());
    windowOpen.value = true;
  } catch {
    // 退化为系统浏览器
    await openUrl(qzoneUrl());
    windowOpen.value = true;
  }
}

async function closeQzoneWindow() {
  try {
    await closeQzoneBrowserWindow();
  } catch { /* ignore */ }
  windowOpen.value = false;
}

/** 用户在独立窗口里自行关闭时同步按钮状态, 读取失败时保持当前显示 */
async function syncWindowState() {
  try {
    windowOpen.value = await qzoneBrowserWindowOpen();
  } catch { /* ignore */ }
}

onMounted(async () => {
  await openQzoneWindow();
  await syncWindowState();
  stateTimer = window.setInterval(syncWindowState, WINDOW_STATE_INTERVAL_MS);
});

onBeforeUnmount(async () => {
  if (stateTimer !== undefined) window.clearInterval(stateTimer);
  await closeQzoneWindow();
});
</script>

<template>
  <div class="qzone-page qzone-external-page">
    <div class="qzone-external">
      <span class="qzone-external-icon"><i class="pi pi-globe" /></span>
      <h3 v-if="windowOpen">QQ 空间已在独立窗口中打开</h3>
      <h3 v-else>正在打开 QQ 空间…</h3>
      <p>由于腾讯限制，QQ 空间无法嵌入到本软件内，将以独立窗口打开。</p>
      <div class="qzone-external-actions">
        <Button
          :label="windowOpen ? '重新打开' : '打开 QQ 空间'"
          :icon="windowOpen ? 'pi pi-refresh' : 'pi pi-external-link'"
          @click="openQzoneWindow"
        />
        <Button
          v-if="windowOpen"
          label="关闭窗口"
          icon="pi pi-times"
          severity="secondary"
          text
          @click="closeQzoneWindow"
        />
      </div>
    </div>
  </div>
</template>
