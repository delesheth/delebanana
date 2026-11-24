// Khởi động backend cục bộ: chỉ nghe 127.0.0.1 (D-8), dữ liệu ở DELE_DATA_DIR. Bộ xếp lịch chạy mỗi 2 giây.

import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway } from './agents/gateway.ts';
import { runClaude } from './agents/harness.ts';
import { Runtime } from './agents/runtime.ts';
import { EventBus } from './core/bus.ts';
import { pruneEvents } from './core/prune.ts';
import { seedIfEmpty } from './core/seed.ts';
import type { Deps } from './core/unitOfWork.ts';
import { defaultDataDir, openDb } from './db/client.ts';
import { createApp } from './http/app.ts';
import { Accounts } from './publish/accounts.ts';
import { createMetaClient } from './publish/meta.ts';
import { PublishWorker } from './publish/worker.ts';

const dataDir = defaultDataDir();
mkdirSync(dataDir, { recursive: true });
const deps: Deps = { db: openDb(join(dataDir, 'db.sqlite')), bus: new EventBus() };
seedIfEmpty(deps);
pruneEvents(deps.db, Date.now());
setInterval(() => pruneEvents(deps.db, Date.now()), 86_400_000).unref();

const port = Number(process.env.PORT ?? 8787);
const uploadDir = join(dataDir, 'uploads');
const videoDir = join(dataDir, 'videos');
const gateway = new Gateway(deps);
const runtime = new Runtime(deps, gateway, {
  harness: runClaude,
  backendUrl: () => `http://127.0.0.1:${port}`,
  logDir: join(dataDir, 'logs', 'cli'),
  uploadDir,
});
runtime.recover();
const metaClient = createMetaClient();
const accounts = new Accounts(deps, metaClient, port);
const publisher = new PublishWorker(deps, metaClient, accounts, { videoDir });

serve({ fetch: createApp(deps, {
    gateway,
    accounts,
    port,
    uploadDir,
    videoDir,
    onShutdown: () => {
      console.log('Dele Banana backend: tắt theo yêu cầu từ giao diện (nút Stop).');
      process.exit(0);
    },
  }).fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`Dele Banana backend: http://127.0.0.1:${info.port} (dữ liệu: ${dataDir})`);
  setInterval(() => {
    try {
      runtime.tick();
    } catch (err) {
      console.error('Bộ xếp lịch lỗi:', err);
    }
  }, 2_000);
  setInterval(() => {
    publisher.tick().catch((err) => console.error('Worker đăng bài lỗi:', err instanceof Error ? err.message : err));
  }, 5_000);
});
