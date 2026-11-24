// Dữ liệu tối thiểu cho kiểm thử: một Workspace, một Researcher, một Campaign, một task `queued`.

import { openDb, type Db } from '../db/client.ts';
import { agents, campaigns, conversations, tasks, workspaces } from '../db/schema.ts';

export const T0 = 1_800_000_000_000;

export function minimal(db: Db = openDb(':memory:')) {
  const ids = { workspace: 'W1', researcher: 'A-R', director: 'A-D', coordinator: 'A-C', campaign: 'C1', task: 'T1', conversation: 'CV1' };
  db.insert(workspaces).values({ id: ids.workspace, name: 'Thử', createdAt: T0, updatedAt: T0 }).run();
  const agent = (id: string, roleTemplate: string, name: string, permissions: string[] = []) => ({
    id,
    workspaceId: ids.workspace,
    roleTemplate,
    title: roleTemplate,
    name,
    provider: 'claude',
    model: 'sonnet',
    permissions,
    createdAt: T0,
    updatedAt: T0,
  });
  db.insert(agents)
    .values([
      agent(ids.researcher, 'researcher', 'An', ['web.research']),
      agent(ids.director, 'director', 'Linh', ['user.converse', 'campaign.brief.write']),
      agent('A-CR', 'creative', 'Bình'),
      agent('A-S', 'scriptwriter', 'Hà'),
      agent(ids.coordinator, 'coordinator', 'Minh', ['task.manage']),
    ])
    .run();
  db.insert(conversations).values({ id: ids.conversation, workspaceId: ids.workspace, kind: 'director', createdAt: T0 }).run();
  db.insert(campaigns)
    .values({ id: ids.campaign, workspaceId: ids.workspace, title: 'Trà sữa', stages: ['research', 'scripting'], status: 'active', currentStage: 'research', brief: { goal: 'Tăng nhận diện', audience: 'Sinh viên', product: 'Trà sữa', platforms: ['tiktok'] }, createdAt: T0, updatedAt: T0 })
    .run();
  db.insert(tasks)
    .values({
      id: ids.task,
      campaignId: ids.campaign,
      stage: 'research',
      kind: 'research.trend',
      requiredRole: 'researcher',
      assigneeAgentId: ids.researcher,
      status: 'queued',
      createdAt: T0,
      updatedAt: T0,
    })
    .run();
  return { db, ids };
}
