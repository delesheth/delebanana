// Lớp kết nối tới server: GET /snapshot rồi SSE /events?after=<seq>. Thuần TS, phụ thuộc được tiêm vào để kiểm thử
// trong node (không có EventSource). Mỗi lần nối lại đều đi qua snapshot nên trạng thái luôn khớp server;
// không bao giờ sinh sự kiện giả — mất kết nối chỉ làm trạng thái thành `offline` rồi thử lại.

import { EVENT_TYPES, type DomainEvent, type ServerSnapshot } from '@delebanana/domain';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

/** Phần của office store mà kết nối cần. */
export interface LiveSink {
  loadSnapshot(snap: ServerSnapshot): void;
  /** `unknown_agent` = sự kiện nhắc tới Agent không có trong roster → phải đồng bộ lại. */
  receive(e: DomainEvent): 'ok' | 'unknown_agent';
  needsResync(): boolean;
  setConnection(status: ConnectionStatus): void;
}

/** Phần của `EventSource` mà kết nối dùng. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void;
  close(): void;
}

export interface LiveOptions {
  /** Tiền tố URL của server, ví dụ `/api` (Vite proxy) hoặc `http://127.0.0.1:8787`. */
  baseUrl: string;
  sink: LiveSink;
  fetch?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  openEventSource?: (url: string) => EventSourceLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  retry?: { initialMs: number; maxMs: number };
}

export interface LiveConnection {
  stop(): void;
  /** Đang chờ thử lại (offline) thì thử ngay, đặt lại thời gian chờ; đang kết nối thì không làm gì. */
  retryNow(): void;
  /** Bỏ kết nối hiện tại và đồng bộ lại ngay (vd. vừa tắt server: biết ngay là offline, không đợi proxy báo lỗi). */
  resync(): void;
}

const DEFAULT_RETRY = { initialMs: 1000, maxMs: 10_000 };

function isSnapshot(v: unknown): v is ServerSnapshot {
  const s = v as Partial<ServerSnapshot> | null;
  return !!s && typeof s.seq === 'number' && !!s.agents && Array.isArray(s.roster) && Array.isArray(s.workspaces);
}

export function createLiveConnection(opts: LiveOptions): LiveConnection {
  const { baseUrl, sink } = opts;
  const doFetch = opts.fetch ?? ((url: string) => fetch(url));
  const open = opts.openEventSource ?? ((url: string) => new EventSource(url));
  const schedule = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const retry = opts.retry ?? DEFAULT_RETRY;

  let stopped = false;
  /** Mỗi lần đồng bộ/ngắt tăng một nấc; callback của vòng cũ thấy lệch nấc thì bỏ qua (chỉ một đồng bộ có hiệu lực). */
  let generation = 0;
  let source: EventSourceLike | undefined;
  let timer: unknown;
  let delay = retry.initialMs;

  function teardown() {
    generation++;
    source?.close();
    source = undefined;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  }

  function fail() {
    teardown();
    if (stopped) return;
    sink.setConnection('offline');
    timer = schedule(() => {
      timer = undefined;
      void sync();
    }, delay);
    delay = Math.min(delay * 2, retry.maxMs);
  }

  async function sync() {
    teardown();
    const mine = generation;
    let snap: ServerSnapshot;
    try {
      const res = await doFetch(`${baseUrl}/snapshot`);
      if (!res.ok) throw new Error('snapshot không thành công');
      const body = await res.json();
      if (!isSnapshot(body)) throw new Error('snapshot sai định dạng');
      snap = body;
    } catch {
      if (mine === generation) fail();
      return;
    }
    if (mine !== generation) return;
    sink.loadSnapshot(snap);

    const es = open(`${baseUrl}/events?after=${snap.seq}`);
    source = es;
    es.addEventListener('open', () => {
      if (mine !== generation) return;
      delay = retry.initialMs;
      sink.setConnection('online');
    });
    es.addEventListener('error', () => {
      if (mine === generation) fail();
    });
    es.addEventListener('resync', () => {
      if (mine === generation) void sync();
    });
    es.addEventListener('ping', () => {});
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (ev) => {
        if (mine !== generation) return;
        let event: DomainEvent;
        try {
          event = JSON.parse(String(ev.data)) as DomainEvent;
        } catch {
          return;
        }
        if (sink.receive(event) === 'unknown_agent' || sink.needsResync()) void sync();
      });
    }
  }

  void sync();
  return {
    stop() {
      stopped = true;
      teardown();
    },
    retryNow() {
      if (stopped || timer === undefined) return;
      delay = retry.initialMs;
      void sync();
    },
    resync() {
      if (stopped) return;
      delay = retry.initialMs;
      void sync();
    },
  };
}
