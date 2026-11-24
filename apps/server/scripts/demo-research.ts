// Tạo một Campaign đang chạy với một task nghiên cứu cho An — để thử bộ xếp lịch trước khi có API của phần 3.
// Chạy: DELE_DATA_DIR=<thư mục> node apps/server/scripts/demo-research.ts

import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EventBus } from '../src/core/bus.ts';
import { seedIfEmpty } from '../src/core/seed.ts';
import { runTx } from '../src/core/unitOfWork.ts';
import { defaultDataDir, openDb } from '../src/db/client.ts';
import { agents, campaigns, tasks } from '../src/db/schema.ts';
import { newId } from '../src/ids.ts';

const dir = defaultDataDir();
mkdirSync(dir, { recursive: true });
const deps = { db: openDb(join(dir, 'db.sqlite')), bus: new EventBus() };
const { workspaceId } = seedIfEmpty(deps);
const an = deps.db.select().from(agents).where(eq(agents.name, 'An')).get()!;

const ids = runTx(deps, (u) => {
  const campaignId = newId();
  u.tx
    .insert(campaigns)
    .values({
      id: campaignId,
      workspaceId,
      title: 'Bông Bông — TikTok tháng 12',
      brief: { goal: 'Tăng nhận diện thương hiệu trên TikTok', audience: 'Sinh viên 18–25 ở TP.HCM', product: 'Trà sữa trân châu đường đen, 35.000đ', platforms: ['tiktok'] },
      stages: ['research', 'scripting'],
      status: 'active',
      currentStage: 'research',
      createdAt: u.now,
      updatedAt: u.now,
    })
    .run();
  u.emit({ type: 'campaign.created', workspaceId, campaignId, entity: { kind: 'campaign', id: campaignId }, actor: 'user', data: { title: 'Bông Bông — TikTok tháng 12' } });
  const taskId = newId();
  u.tx
    .insert(tasks)
    .values({
      id: taskId,
      campaignId,
      stage: 'research',
      kind: 'research.trend',
      requiredRole: 'researcher',
      assigneeAgentId: an.id,
      input: { title: 'Xu hướng TikTok cho trà sữa ở TP.HCM', instructions: 'Tìm 3 xu hướng nội dung TikTok gần đây phù hợp với trà sữa đường đen cho sinh viên.' },
      status: 'queued',
      createdAt: u.now,
      updatedAt: u.now,
    })
    .run();
  u.emit({ type: 'task.created', workspaceId, campaignId, entity: { kind: 'task', id: taskId }, actor: 'user', data: { kind: 'research.trend', stage: 'research', requiredRole: 'researcher', dependsOn: [] } });
  return { campaignId, taskId };
});
console.log(JSON.stringify(ids));
