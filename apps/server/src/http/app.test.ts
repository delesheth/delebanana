import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/client.ts';
import { events } from '../db/schema.ts';
import { EventBus } from '../core/bus.ts';
import { DEFAULT_ROSTER, seedIfEmpty } from '../core/seed.ts';
import { runTx, type Deps } from '../core/unitOfWork.ts';
import { createApp } from './app.ts';

interface Sse {
  id?: string;
  event?: string;
  data?: string;
}

const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
afterEach(async () => {
  for (const r of readers.splice(0)) await r.cancel().catch(() => {});
});

/** Mở /events và trả hàm đọc tiếp n sự kiện SSE (bỏ qua ping). */
async function open(app: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  readers.push(reader);
  const decoder = new TextDecoder();
  let buf = '';
  return async (n: number): Promise<Sse[]> => {
    const out: Sse[] = [];
    while (out.length < n) {
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0 && out.length < n) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev: Sse = {};
        for (const line of block.split('\n')) {
          const [k, ...rest] = line.split(': ');
          if (k === 'id' || k === 'event' || k === 'data') ev[k] = rest.join(': ');
        }
        if (ev.event !== 'ping') out.push(ev);
      }
      if (out.length >= n) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    return out;
  };
}

function setup() {
  const db = openDb(':memory:');
  const deps: Deps = { db, bus: new EventBus() };
  const { workspaceId } = seedIfEmpty(deps);
  const emit = () =>
    runTx(deps, (u) =>
      u.emit({ type: 'campaign.created', workspaceId, entity: { kind: 'campaign', id: 'C' }, actor: 'user', data: { title: 'Mới' } }),
    );
  return { app: createApp(deps), emit, deps };
}

/** Số sự kiện seed: mỗi Agent một `agent.state_changed` idle. */
const N = DEFAULT_ROSTER.length;

describe('HTTP', () => {
  it('/health', async () => {
    const res = await setup().app.request('/health');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('/snapshot trả đủ Agent của đội mặc định (8)', async () => {
    const body = await (await setup().app.request('/snapshot')).json();
    expect(body.seq).toBeGreaterThan(0);
    expect(Object.keys(body.agents)).toHaveLength(DEFAULT_ROSTER.length);
  });
});

describe('/events (SSE)', () => {
  it('phát lại sự kiện từ after rồi gửi tiếp sự kiện mới', async () => {
    const { app, emit } = setup();
    const next = await open(app, '/events?after=0');
    const backlog = await next(N);
    expect(backlog.map((e) => e.event)).toEqual(Array(N).fill('agent.state_changed'));
    expect(backlog.map((e) => Number(e.id))).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    const live = emit();
    const [e] = await next(1);
    expect(e).toMatchObject({ event: 'campaign.created', id: String(live.seq) });
    expect(JSON.parse(e!.data!)).toMatchObject({ type: 'campaign.created', seq: live.seq });
  });

  it('hai kết nối cùng nhận một sự kiện mới', async () => {
    const { app, emit } = setup();
    const a = await open(app, `/events?after=${N}`);
    const b = await open(app, `/events?after=${N}`);
    const live = emit();
    expect((await a(1))[0]?.id).toBe(String(live.seq));
    expect((await b(1))[0]?.id).toBe(String(live.seq));
  });

  it('mọi sự kiện đã bị dọn: nối lại từ seq cuối không bị resync, vẫn nhận sự kiện mới', async () => {
    const { app, emit, deps } = setup();
    deps.db.delete(events).run();
    const next = await open(app, `/events?after=${N}`);
    const live = emit();
    expect((await next(1))[0]).toMatchObject({ event: 'campaign.created', id: String(live.seq) });
  });

  it('after lớn hơn seq hiện tại → resync', async () => {
    const next = await open(setup().app, '/events?after=999999');
    expect((await next(1))[0]?.event).toBe('resync');
  });

  it('kết nối lại: Last-Event-ID thắng ?after= trong URL cũ', async () => {
    const next = await open(setup().app, '/events?after=2', { 'Last-Event-ID': '4' });
    expect((await next(N - 4)).map((e) => e.id)).toEqual(Array.from({ length: N - 4 }, (_, i) => String(i + 5)));
  });

  it('Last-Event-ID → chỉ nhận seq lớn hơn', async () => {
    const next = await open(setup().app, '/events', { 'Last-Event-ID': '3' });
    expect((await next(N - 3)).map((e) => e.id)).toEqual(Array.from({ length: N - 3 }, (_, i) => String(i + 4)));
  });
});
