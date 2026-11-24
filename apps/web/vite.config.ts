import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
import { devServerStarter } from './devServerStarter.ts';

// Server chặn Host lạ và request khác origin, nên web gọi qua proxy cùng origin thay vì CORS.
// Không bật changeOrigin: Host giữ nguyên `localhost` để qua bộ chặn Host của server.
const backend = process.env.DELE_BACKEND_URL ?? 'http://127.0.0.1:8787';
// Server tắt/khởi động lại giữa chừng thì proxy không tự đóng luồng SSE /events phía trình duyệt: web không biết đã mất
// kết nối, giữ trạng thái Agent cũ mãi. Cắt luồng ngay khi phía server đóng để EventSource báo lỗi và đồng bộ lại.
const configure: ProxyOptions['configure'] = (p) =>
  p.on('proxyRes', (proxyRes, _req, res) => proxyRes.on('close', () => !res.writableEnded && res.destroy()));
const proxy = { '/api': { target: backend, rewrite: (path: string) => path.replace(/^\/api/, ''), configure } };

export default defineConfig({
  plugins: [react(), devServerStarter()],
  server: { proxy },
  preview: { proxy },
});
