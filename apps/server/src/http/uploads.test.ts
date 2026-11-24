import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../agents/gateway.ts';
import { Runtime } from '../agents/runtime.ts';
import type { HarnessSpec } from '../agents/harness.ts';
import { EventBus } from '../core/bus.ts';
import { T0, minimal } from '../test/fixtures.ts';
import { createApp } from './app.ts';

// PNG 1×1 trong suốt.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function campaign(s: ReturnType<typeof setup>): Promise<string> {
  return (await (await s.req('POST', '/campaigns', { title: 'A' })).json()).id as string;
}

function setup() {
  const { db, ids } = minimal();
  let now = T0;
  const deps = { db, bus: new EventBus(), clock: () => ++now };
  const uploadDir = mkdtempSync(join(tmpdir(), 'dele-up-'));
  const gateway = new Gateway(deps);
  const app = createApp(deps, { gateway, uploadDir });
  const req = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return res;
  };
  return { db, ids, deps, gateway, uploadDir, req };
}

describe('ảnh đính kèm', () => {
  it('tải ảnh lên → 201, đọc lại đúng byte và Content-Type', async () => {
    const s = setup();
    const up = await s.req('POST', '/uploads', { name: 'giay.png', mime: 'image/png', data: PNG });
    expect(up.status).toBe(201);
    const a = (await up.json()) as { id: string; name: string; mime: string };
    expect(a).toMatchObject({ name: 'giay.png', mime: 'image/png' });
    const got = await s.req('GET', `/uploads/${a.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(PNG, 'base64'))).toBe(true);
    expect((await s.req('GET', '/uploads/../../etc')).status).toBe(404);
  });

  it('sai định dạng hoặc thiếu dữ liệu → 400', async () => {
    const s = setup();
    expect((await s.req('POST', '/uploads', { name: 'a.svg', mime: 'image/svg+xml', data: PNG })).status).toBe(400);
    expect((await s.req('POST', '/uploads', { name: 'a.png', mime: 'image/png', data: '' })).status).toBe(400);
  });

  it('tin chỉ có ảnh được nhận; ảnh không tồn tại → 400', async () => {
    const s = setup();
    const cid = await campaign(s);
    const a = await (await s.req('POST', '/uploads', { name: 'giay.png', mime: 'image/png', data: PNG })).json();
    expect((await s.req('POST', '/conversations/director/messages', { content: '', campaignId: cid, attachments: [a] })).status).toBe(201);
    const list = (await (await s.req('GET', `/conversations/director/messages?campaignId=${cid}`)).json()) as { attachments: unknown }[];
    expect(list.at(-1)!.attachments).toEqual([a]);
    const fake = { id: '01HZZZZZZZZZZZZZZZZZZZZZZZ', name: 'x.png', mime: 'image/png' };
    expect((await s.req('POST', '/conversations/director/messages', { content: 'xem', campaignId: cid, attachments: [fake] })).status).toBe(400);
  });

  it('Director nhận ảnh trong thư mục lượt chạy và được bật Read', async () => {
    const s = setup();
    const cid = await campaign(s);
    const a = await (await s.req('POST', '/uploads', { name: 'giay.png', mime: 'image/png', data: PNG })).json();
    await s.req('POST', '/conversations/director/messages', { content: 'Đây là sản phẩm', campaignId: cid, attachments: [a] });
    const specs: HarnessSpec[] = [];
    const runtime = new Runtime(s.deps, s.gateway, {
      harness: async (spec) => {
        specs.push(spec);
        return { outcome: 'ok', exitCode: 0, durationMs: 1, denials: 0, rateLimits: [] };
      },
      backendUrl: () => 'http://127.0.0.1:1',
      logDir: mkdtempSync(join(tmpdir(), 'dele-rt-')),
      uploadDir: s.uploadDir,
      clock: () => T0 + 100,
    });
    runtime.tick();
    await runtime.idle();
    const director = specs.find((sp) => sp.prompt.includes('Hội thoại riêng của chiến dịch'))!;
    expect(director.tools).toContain('Read');
    expect(director.files).toEqual([{ from: join(s.uploadDir, `${a.id}.png`), name: `anh/${a.id}.png` }]);
    expect(director.prompt).toContain(`anh/${a.id}.png`);
  });
});
