<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { openQzoneBrowserWindow, openUrl } from "../utils/ipc";
import Button from "primevue/button";
import Popover from "primevue/popover";
import LoginDialog from "../components/LoginDialog.vue";
import sidebarToggleIcon from "../assets/sidebar-toggle.png";
import { useAppStore } from "../stores/app";
import { useAuthStore } from "../stores/auth";

defineProps<{ pageTitle: string }>();
const appStore = useAppStore();
const authStore = useAuthStore();
const router = useRouter();
const accountPopover = ref<InstanceType<typeof Popover>>();
const logoutLoading = ref(false);
const { darkMode, sidebarCollapsed, themeIcon } = storeToRefs(appStore);
const { loggedIn, user } = storeToRefs(authStore);
/** QQ 空间入口在桌面三平台与网页预览下都可用 */
const showQzoneButton = true;
const navigation = [
  { label: "概览", icon: "pi pi-home", to: "/" },
  { label: "归档", icon: "pi pi-inbox", to: "/archives" },
  { label: "联系人", icon: "pi pi-users", to: "/contacts" },
  { label: "媒体", icon: "pi pi-images", to: "/media" },
  { label: "任务", icon: "pi pi-sync", to: "/tasks" },
  { label: "回收站", icon: "pi pi-trash", to: "/recycle-bin" },
];
const settingsItem = { label: "设置", icon: "pi pi-cog", to: "/settings" };
function qzoneUrl() {
  const uin = user.value?.uin;
  return uin ? `https://user.qzone.qq.com/${uin}` : "https://user.qzone.qq.com";
}
async function openQzoneWindow() {
  try {
    await openQzoneBrowserWindow(qzoneUrl());
  } catch {
    await openUrl(qzoneUrl());
  }
}

function handleAccountClick(event: MouseEvent) {
  if (loggedIn.value) accountPopover.value?.toggle(event);
  else authStore.openLogin();
}
async function logout() {
  if (logoutLoading.value) return;
  logoutLoading.value = true;
  try {
    accountPopover.value?.hide();
    await authStore.logout();
    await router.push("/");
  } finally { logoutLoading.value = false; }
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-dark': darkMode, 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="desktop-sidebar">
      <div class="brand">
        <button
          class="brand-mark"
          type="button"
          :class="{ 'is-toggle': sidebarCollapsed }"
          :title="sidebarCollapsed ? '展开侧边栏' : undefined"
          aria-label="折叠侧边栏"
          @click="sidebarCollapsed && appStore.toggleSidebar()"
        >
          <i class="pi pi-box brand-app-icon" />
          <img v-if="sidebarCollapsed" class="brand-toggle-icon" :src="sidebarToggleIcon" alt="" />
        </button>
        <div class="brand-copy"><strong>空间归档</strong><span>Qzone Archive</span></div>
      </div>
      <button v-if="!sidebarCollapsed" class="sidebar-collapse-btn" type="button" title="折叠侧边栏" aria-label="折叠侧边栏" @click="appStore.toggleSidebar">
        <img class="sidebar-collapse-icon" :src="sidebarToggleIcon" alt="" />
      </button>
      <nav class="side-navigation" aria-label="主要导航">
        <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" :title="sidebarCollapsed ? item.label : undefined">
          <i :class="item.icon" /><span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        <RouterLink :to="settingsItem.to" :title="sidebarCollapsed ? settingsItem.label : undefined" class="sidebar-settings-link">
          <i :class="settingsItem.icon" /><span>{{ settingsItem.label }}</span>
        </RouterLink>
      </div>
    </aside>
    <div class="app-workspace">
      <header class="topbar">
        <div><p class="topbar-eyebrow">QZONE ARCHIVE</p><h1>{{ pageTitle }}</h1></div>
        <div class="topbar-actions">
          <Button :icon="themeIcon" severity="secondary" text rounded aria-label="切换主题" @click="appStore.toggleTheme" />
          <button class="account-chip" type="button" :aria-label="loggedIn ? '打开账号菜单' : '登录 QQ 空间'" @click="handleAccountClick">
            <span class="account-avatar">
              <img v-if="user?.avatarImage" :src="user.avatarImage" alt="" />
              <i v-else class="pi pi-user" />
            </span>
            <span class="account-copy"><strong>{{ user?.nickname ?? '尚未登录' }}</strong><small>{{ user ? `QQ ${user.uin}` : '登录 QQ 空间' }}</small></span>
            <span v-if="loggedIn" class="account-menu-indicator"><i class="pi pi-angle-down account-menu-arrow" /><i class="pi pi-sign-out account-menu-logout" /></span>
          </button>
          <Popover ref="accountPopover" class="account-popover">
            <div class="account-popover-profile"><span class="account-popover-avatar"><img v-if="user?.avatarImage" :src="user.avatarImage" alt="" /><i v-else class="pi pi-user" /></span><div><strong>{{ user?.nickname }}</strong><span>QQ {{ user?.uin }}</span></div></div>
            <div class="account-popover-divider" />
            <Button v-if="showQzoneButton" label="QQ 空间" icon="pi pi-globe" severity="secondary" text @click="openQzoneWindow(); accountPopover?.hide()" />
            <Button label="退出登录" icon="pi pi-sign-out" severity="danger" text :loading="logoutLoading" @click="logout" />
          </Popover>
        </div>
      </header>
      <main class="page-content"><slot /></main>
    </div>
    <LoginDialog />
  </div>
</template>
