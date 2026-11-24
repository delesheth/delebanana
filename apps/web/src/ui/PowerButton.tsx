// Nút nguồn ở giữa phía trên văn phòng. Server đang chạy → "Stop": tắt đèn, nhân viên biến mất, tắt `pnpm server`.
// Server tắt → "Start" (chỉ khi `pnpm dev`, nhờ plugin devServerStarter.ts): chạy server, bật đèn, nhân viên đi vào.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { live } from '../live/instance.ts';
import { office } from '../sim/officeStore.ts';

const WAIT_MS = 45_000;
const DEV_HEADERS = { 'x-dele-dev': '1' };

async function stopServer(): Promise<void> {
  // Server do nút Start chạy (qua plugin) → plugin tắt cả nhóm tiến trình; còn lại nhờ chính server tự tắt.
  if (import.meta.env.DEV) {
    const res = await fetch('/__dev/server/stop', { method: 'POST', headers: DEV_HEADERS });
    if (res.ok && ((await res.json()) as { owned?: boolean }).owned) return;
  }
  const res = await fetch('/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`Server trả lỗi ${res.status}`);
}

export function PowerButton() {
  const { connection, lightsOn } = useSyncExternalStore(office.subscribeUi, office.getUi);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sau khi bấm Start: thử nối lại mỗi giây tới khi online thay vì chờ hết thời gian lùi của kết nối.
  useEffect(() => {
    if (!starting) return;
    if (connection === 'online') {
      setStarting(false);
      return;
    }
    const began = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - began > WAIT_MS) {
        setStarting(false);
        setError('Server chưa lên sau 45 giây — xem log ở terminal đang chạy pnpm dev.');
        return;
      }
      live.retryNow();
    }, 1000);
    return () => clearInterval(timer);
  }, [starting, connection]);

  // Sau khi bấm Stop: kiểm tra lại kết nối mỗi nửa giây cho tới khi thấy server đã tắt (proxy có thể không báo ngay).
  useEffect(() => {
    if (!stopping) return;
    if (connection === 'offline') {
      setStopping(false);
      return;
    }
    const timer = setInterval(() => live.resync(), 500);
    return () => clearInterval(timer);
  }, [stopping, connection]);

  async function stop() {
    setError(null);
    office.beginShutdown();
    try {
      await stopServer();
      setStopping(true);
    } catch (e) {
      office.cancelShutdown();
      setError(`Không tắt được server: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch('/__dev/server/start', { method: 'POST', headers: DEV_HEADERS });
      if (!res.ok) throw new Error(`Vite trả lỗi ${res.status}`);
    } catch (e) {
      setStarting(false);
      setError(`Không chạy được server: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let button;
  if (connection === 'online' && lightsOn) {
    button = (
      <button type="button" className="power stop" onClick={() => void stop()} title="Tắt server: văn phòng tắt đèn, nhân viên về nhà">
        ■ Stop
      </button>
    );
  } else if (connection === 'connecting' && lightsOn) {
    button = (
      <button type="button" className="power" disabled>
        Đang kết nối…
      </button>
    );
  } else if (connection !== 'offline') {
    button = (
      <button type="button" className="power" disabled>
        Đang tắt…
      </button>
    );
  } else if (import.meta.env.DEV) {
    button = (
      <button type="button" className="power start" onClick={() => void start()} disabled={starting} title="Chạy server: văn phòng bật đèn, nhân viên đi làm">
        {starting ? 'Đang khởi động…' : '▶ Start'}
      </button>
    );
  } else {
    button = (
      <span className="power off">
        Server đang tắt — chạy <code>pnpm server</code>
      </span>
    );
  }

  return (
    <div className="power-bar">
      {button}
      {error && (
        <span className="power-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
