// Bảng thông tin khi click nhân vật (góc trên bên trái): tên, vai trò và việc đang làm bằng lời cho người dùng.

import type { TaskInfo } from '@delebanana/domain';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../campaign/instance.ts';
import { office } from '../sim/officeStore.ts';
import { STATE_TEXT } from './AgentChips.tsx';
import { ROLE_LABEL } from './labels.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Tải task theo id (tên task + Campaign); `undefined` khi không có task hoặc chưa tải xong. */
function useTask(taskId: string | undefined): TaskInfo | undefined {
  const [info, setInfo] = useState<TaskInfo | undefined>();
  useEffect(() => {
    setInfo(undefined);
    if (!taskId) return;
    let alive = true;
    api
      .getTask(taskId)
      .then((t) => alive && setInfo(t))
      .catch(() => {
        // task đã bị xoá hoặc server tắt: chỉ hiện trạng thái
      });
    return () => {
      alive = false;
    };
  }, [taskId]);
  return info;
}

export function AgentPanel() {
  const { selectedId, lightsOn } = useSyncExternalStore(office.subscribeUi, office.getUi);
  const rt = selectedId ? office.runtime(selectedId) : undefined;
  const taskId = selectedId ? office.taskOf(selectedId) : undefined;
  const info = useTask(lightsOn ? taskId : undefined);
  if (!lightsOn || !rt || !selectedId) return null;
  const stateText = STATE_TEXT[office.stateOf(selectedId)];
  const input = (info?.task.input ?? {}) as { title?: unknown; instructions?: unknown };
  const title = typeof input.title === 'string' && input.title.trim() ? input.title : undefined;
  return (
    <aside className="agent-panel">
      <button className="close" onClick={() => office.select(null)} aria-label="Đóng">
        ×
      </button>
      <h2>{rt.profile.name}</h2>
      <p className="role">{ROLE_LABEL[rt.profile.role] ?? rt.profile.role}</p>
      <div className="agent-task">
        <span className="label">Task</span>
        {info ? (
          <>
            <strong>{title ?? stateText}</strong>
            {info.campaignTitle && <span className="campaign">Campaign: {info.campaignTitle}</span>}
            {typeof input.instructions === 'string' && input.instructions.trim() && <p className="desc">{clip(input.instructions.trim(), 240)}</p>}
          </>
        ) : (
          <strong>{stateText}</strong>
        )}
      </div>
    </aside>
  );
}
