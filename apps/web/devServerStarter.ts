// Plugin chỉ dùng khi `pnpm dev`: nút "Start" trên UI gọi POST /__dev/server/start để chạy `pnpm server` ngay dưới
// tiến trình Vite (log in chung terminal); "Stop" gọi /__dev/server/stop để tắt cả nhóm tiến trình đó (pnpm → node --watch
// → server). Server không do plugin chạy thì Stop trả `owned: false`, giao diện tự gọi POST /shutdown của server.
// Yêu cầu header riêng nên trang khác không gửi được (CORS chặn trước).

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEV_HEADER = 'x-dele-dev';

export function devServerStarter(): Plugin {
  let child: ChildProcess | undefined;
  /** Tắt cả nhóm tiến trình (chạy `detached` nên pid nhóm = pid của pnpm). */
  const stop = () => {
    if (child?.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    child = undefined;
  };
  const allowed = (req: { method?: string; headers: Record<string, string | string[] | undefined> }) => req.method === 'POST' && req.headers[DEV_HEADER] === '1';
  return {
    name: 'dele-dev-server-starter',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/server/start', (req, res) => {
        if (!allowed(req)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const already = !!child && child.exitCode === null;
        if (!already) {
          const proc = spawn('pnpm', ['server'], { cwd: ROOT, stdio: 'inherit', env: process.env, detached: true });
          child = proc;
          proc.on('exit', (code) => {
            if (child === proc) child = undefined;
            server.config.logger.info(`[dele] pnpm server đã dừng (mã ${code ?? 'tín hiệu'})`);
          });
          proc.on('error', (err) => server.config.logger.error(`[dele] không chạy được pnpm server: ${err.message}`));
          server.config.logger.info('[dele] đang chạy pnpm server…');
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ started: !already, running: true }));
      });
      server.middlewares.use('/__dev/server/stop', (req, res) => {
        if (!allowed(req)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const owned = !!child && child.exitCode === null;
        if (owned) {
          server.config.logger.info('[dele] tắt pnpm server (nút Stop)…');
          stop();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ owned }));
      });
      server.httpServer?.on('close', stop);
      process.once('exit', stop);
    },
  };
}
