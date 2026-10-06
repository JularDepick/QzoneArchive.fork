import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const rendererRoot = fileURLToPath(new URL("src/renderer", import.meta.url));
const publicRoot = fileURLToPath(new URL("public", import.meta.url));
const outputRoot = fileURLToPath(new URL("dist/renderer", import.meta.url));

// 渲染进程(前端)构建配置: 开发服务器固定 1420 端口, 由 Electron 主进程通过 QZA_DEV_SERVER_URL 加载
// 打包后以 file:// 加载, 因此 base 使用相对路径
export default defineConfig({
  root: rendererRoot,
  base: "./",
  publicDir: publicRoot,
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    target: "chrome120",
  },
});
