import { eq } from 'drizzle-orm';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalError } from '../campaign/shared.ts';
import { decideApprovePublish, markPostPublished, retryPost } from '../campaign/publishing.ts';
import { messages, posts, socialAccounts, videoVersions } from '../db/schema.ts';
import { T0 } from '../test/fixtures.ts';
import { FakeMeta, publishingSetup, type SetupOpts } from '../test/publishing.ts';
import { Accounts } from './accounts.ts';
import { MetaError } from './meta.ts';
import { PublishWorker } from './worker.ts';

const HOUR = 3_600_000;
const transient = () => new MetaError('Meta báo lỗi 2: tạm', { transient: true, code: 2 });

function setup(o: SetupOpts = {}, decision?: Record<string, unknown>) {
  const s = publishingSetup({ platforms: ['facebook', 'instagram'], ...o });
  const meta = new FakeMeta();
  const videoDir = mkdtempSync(join(tmpdir(), 'pub-video-'));
  writeFileSync(join(videoDir, 'VV-OK.mp4'), 'x');
  const accounts = new Accounts(s.deps, meta, 8787);
  const worker = new PublishWorker(s.deps, meta, accounts, { videoDir, pollMs: 1000, backoffMs: 1000 });
  const a = s.finishCaption();
  s.tx((u) => decideApprovePublish(u, a.id, 'approved', decision ?? { posts: [{ platform: 'facebook', enabled: true, caption: 'Caption FB #x' }, { platform: 'instagram', enabled: true }], when: { mode: 'now' } }));
  const fb = () => s.db.select().from(posts).where(eq(posts.id, s.post('facebook').id)).get()!;
  return { ...s, meta, worker, videoDir, fb };
}

describe('đăng ngay', () => {
  it('start → tải tệp cục bộ → finish PUBLISHED với description là caption → hỏi trạng thái → published, lưu id và permalink', async () => {
    const s = setup();
    await s.worker.tick();
    expect(s.meta.names()).toEqual(['startReel', 'uploadReel', 'finishReel']);
    const up = s.meta.calls[1]!.args;
    expect(up).toMatchObject([`VID1`, expect.any(String), { path: join(s.videoDir, 'VV-OK.mp4'), size: 1234 }]);
    expect(s.meta.calls[2]!.args[0]).toBe('PG1');
    expect(s.meta.calls[2]!.args[2]).toMatchObject({ videoId: 'VID1', state: 'PUBLISHED', description: 'Caption FB #x' });
    expect(s.fb()).toMatchObject({ status: 'publishing', platformPostId: 'VID1' });
    s.advance(2000);
    s.meta.status = { phase: 'processing' };
    await s.worker.tick();
    expect(s.fb().status).toBe('publishing');
    s.advance(2000);
    s.meta.status = { phase: 'published', permalink: 'https://www.facebook.com/reel/VID1' };
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'published', platformPostId: 'VID1', permalink: 'https://www.facebook.com/reel/VID1', error: null });
    expect(s.meta.names().filter((n) => n === 'startReel')).toHaveLength(1);
  });

  it('bước đăng chỉ done sau khi bài đăng tay cũng xong', async () => {
    const s = setup();
    s.meta.status = { phase: 'published', permalink: 'https://fb/x' };
    await s.worker.tick();
    s.advance(2000);
    await s.worker.tick();
    expect(s.fb().status).toBe('published');
    expect(s.stage('publishing').status).toBe('awaiting_approval');
    s.tx((u) => markPostPublished(u, s.post('instagram').id));
    expect(s.stage('publishing').status).toBe('done');
    expect(s.camp().status).toBe('completed');
  });
});

describe('lên lịch phía Meta', () => {
  it('finish gửi SCHEDULED + scheduled_publish_time (giây); Meta xác nhận lịch → scheduled; tới giờ → publishing → published', async () => {
    const at = T0 + 5 * HOUR;
    const s = setup({}, { posts: [{ platform: 'facebook', enabled: true, caption: 'Hẹn giờ' }, { platform: 'instagram', enabled: false }], when: { mode: 'schedule', at } });
    await s.worker.tick();
    expect(s.meta.calls.find((c) => c.fn === 'finishReel')!.args[2]).toMatchObject({ state: 'SCHEDULED', scheduledPublishTime: Math.floor(at / 1000), description: 'Hẹn giờ' });
    s.advance(2000);
    s.meta.status = { phase: 'scheduled' };
    await s.worker.tick();
    expect(s.fb().status).toBe('scheduled');
    expect(s.stage('publishing').status).toBe('awaiting_approval');
    s.advance(6 * HOUR);
    s.meta.status = { phase: 'published', permalink: 'https://fb/reel/1' };
    await s.worker.tick(); // scheduled → publishing
    await s.worker.tick(); // hỏi trạng thái → published
    expect(s.fb()).toMatchObject({ status: 'published', permalink: 'https://fb/reel/1' });
    expect(s.stage('publishing').status).toBe('done');
    expect(s.camp().status).toBe('completed');
  });
});

describe('lỗi và thử lại', () => {
  it('lỗi tạm thời tự thử lại tối đa 3 lần rồi dừng ở failed chờ người dùng', async () => {
    const s = setup();
    s.meta.fail.startReel = [transient(), transient(), transient(), transient()];
    for (let i = 0; i < 6; i++) {
      await s.worker.tick();
      s.advance(10_000);
    }
    expect(s.meta.names().filter((n) => n === 'startReel')).toHaveLength(4); // 1 lần đầu + 3 lần thử lại
    expect(s.fb()).toMatchObject({ status: 'failed', retries: 3 });
    expect(s.fb().error).toContain('tạm');
    expect(s.db.select().from(messages).all().some((m) => m.content.includes('không thành công'))).toBe(true);
    // user thử lại → publishing, đếm lại; lần này thành công
    s.tx((u) => retryPost(u, s.fb().id));
    expect(s.fb()).toMatchObject({ status: 'publishing', retries: 0, error: null });
    await s.worker.tick();
    expect(s.fb().platformPostId).toBe('VID1');
  });

  it('lỗi không tạm thời (token hết hạn 190) failed ngay, không tự thử, đánh dấu tài khoản hết hạn', async () => {
    const s = setup();
    s.meta.fail.startReel = [new MetaError('Meta báo lỗi 190: expired', { transient: false, code: 190, tokenExpired: true })];
    await s.worker.tick();
    s.advance(100_000);
    await s.worker.tick();
    expect(s.meta.names().filter((n) => n === 'startReel')).toHaveLength(1);
    expect(s.fb()).toMatchObject({ status: 'failed', retries: 0 });
    expect(s.db.select().from(socialAccounts).get()!.status).toBe('expired');
  });

  it('thiếu quyền / 4xx khác failed ngay', async () => {
    const s = setup();
    s.meta.fail.finishReel = [new MetaError('Meta báo lỗi 200: permission', { transient: false, code: 200 })];
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', retries: 0 });
  });

  it('thử lại sau khi đã có video id: hỏi trạng thái, không start lại', async () => {
    const s = setup();
    s.meta.fail.finishReel = [transient()];
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'publishing', retries: 1, platformPostId: 'VID1' });
    s.advance(10_000);
    s.meta.status = { phase: 'uploading' };
    await s.worker.tick();
    expect(s.meta.names().filter((n) => n === 'startReel')).toHaveLength(1);
    // Lỗi transient (mã 2) mơ hồ như lỗi mạng: giữ dấu finish, chờ Meta, không tải/finish lại.
    expect(s.meta.names().filter((n) => n === 'uploadReel')).toHaveLength(1);
    expect(s.meta.names().filter((n) => n === 'finishReel')).toHaveLength(1);
  });
});

describe('hạn mức 30 Reels/24 giờ', () => {
  it('bài thứ 31 không gọi API, failed với lý do hết hạn mức và có thông báo', async () => {
    const s = setup();
    for (let i = 0; i < 30; i++)
      s.db.insert(posts).values({ id: `OLD${i}`, campaignId: s.id, videoVersionId: 'VV-OK', socialAccountId: 'ACC1', platform: 'facebook', mode: 'api', status: 'published', apiCalledAt: T0 + 10 + i, createdAt: T0, updatedAt: T0 }).run();
    await s.worker.tick();
    expect(s.meta.calls).toEqual([]);
    expect(s.fb()).toMatchObject({ status: 'failed', retries: 0 });
    expect(s.fb().error).toContain('Hết hạn mức 30');
    expect(s.db.select().from(messages).all().some((m) => m.content.includes('Hết hạn mức'))).toBe(true);
  });

  it('29 bài đã đăng trong 24 giờ thì bài này vẫn đăng; bài quá 24 giờ không tính', async () => {
    const s = setup();
    for (let i = 0; i < 29; i++) s.db.insert(posts).values({ id: `OLD${i}`, campaignId: s.id, videoVersionId: 'VV-OK', socialAccountId: 'ACC1', platform: 'facebook', mode: 'api', status: 'published', apiCalledAt: T0 + i, createdAt: T0, updatedAt: T0 }).run();
    s.db.insert(posts).values({ id: 'OLD-X', campaignId: s.id, videoVersionId: 'VV-OK', socialAccountId: 'ACC1', platform: 'facebook', mode: 'api', status: 'published', apiCalledAt: T0 - 25 * HOUR, createdAt: T0, updatedAt: T0 }).run();
    await s.worker.tick();
    expect(s.meta.names()[0]).toBe('startReel');
  });
});

describe('kiểm thông số trước khi đăng', () => {
  it('video bị đổi sang sai thông số sau khi duyệt → không gọi API, failed với lý do cụ thể', async () => {
    const s = setup();
    s.db.update(videoVersions).set({ metadata: { durationSeconds: 120, width: 1080, height: 1920 } }).where(eq(videoVersions.id, 'VV-OK')).run();
    await s.worker.tick();
    expect(s.meta.calls).toEqual([]);
    expect(s.fb().status).toBe('failed');
    expect(s.fb().error).toMatch(/120\.0 giây/);
  });
});

describe('đăng tay: nhắc đúng một lần', () => {
  it('tới giờ hẹn → đúng một thông báo nhắc, tick tiếp không nhắc lại', async () => {
    const at = T0 + 2 * HOUR;
    const s = setup({}, { posts: [{ platform: 'facebook', enabled: false }, { platform: 'instagram', enabled: true }], when: { mode: 'schedule', at } });
    const reminders = () => s.db.select().from(messages).all().filter((m) => m.content.startsWith('Đến giờ đăng'));
    await s.worker.tick();
    expect(reminders()).toHaveLength(0);
    s.advance(3 * HOUR);
    await s.worker.tick();
    await s.worker.tick();
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]!.content).toContain('Instagram');
    expect(s.post('instagram').remindedAt).not.toBeNull();
    expect(s.post('instagram').status).toBe('scheduled');
  });
});

const MIN = 10 * 60_000;
const schedAt = (ms: number) => ({ posts: [{ platform: 'facebook', enabled: true, caption: 'Hẹn giờ' }, { platform: 'instagram', enabled: false }], when: { mode: 'schedule', at: T0 + ms } });
const count = (s: { meta: FakeMeta }, fn: string) => s.meta.names().filter((n) => n === fn).length;

describe('video lỗi phía Meta: Thử lại start video mới', () => {
  it('reelStatus error → failed, bỏ video id → retryPost → startReel/uploadReel/finishReel lần hai', async () => {
    const s = setup();
    await s.worker.tick();
    s.advance(2000);
    s.meta.status = { phase: 'error', error: 'bad codec' };
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: null, finishSentAt: null });
    expect(s.fb().error).toContain('bad codec');
    expect(s.fb().apiCalledAt).not.toBeNull();
    s.tx((u) => retryPost(u, s.fb().id));
    await s.worker.tick();
    expect(count(s, 'startReel')).toBe(2);
    expect(count(s, 'uploadReel')).toBe(2);
    expect(count(s, 'finishReel')).toBe(2);
    expect(s.fb()).toMatchObject({ status: 'publishing', platformPostId: 'VID2' });
  });

  it('processing quá 1 giờ sau finish → failed nhắc Meta Business Suite, giữ video id; Thử lại không start video mới', async () => {
    const s = setup();
    await s.worker.tick();
    s.advance(HOUR + 5000);
    s.meta.status = { phase: 'processing' };
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1' });
    expect(s.fb().error).toContain('Meta Business Suite');
    s.tx((u) => retryPost(u, s.fb().id));
    s.meta.status = { phase: 'published', permalink: 'https://fb/x' } as never;
    await s.worker.tick();
    expect(count(s, 'startReel')).toBe(1);
    expect(count(s, 'finishReel')).toBe(1);
    expect(s.fb().status).toBe('published');
  });

  it('upload lỗi, 2 giờ sau Thử lại và finish được, Meta còn processing → không failed (hạn tính từ finishSentAt)', async () => {
    const s = setup();
    s.meta.fail.uploadReel = [new MetaError('Meta báo lỗi 100: x', { transient: false, code: 100 })];
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1' });
    s.advance(2 * HOUR);
    s.tx((u) => retryPost(u, s.fb().id));
    s.meta.status = { phase: 'uploading' };
    await s.worker.tick();
    expect(count(s, 'finishReel')).toBe(1);
    s.advance(5000);
    s.meta.status = { phase: 'processing' };
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'publishing', platformPostId: 'VID1' });
  });

  it('finishReel lỗi mạng (không mã) → giữ finishSentAt, không tải/finish lại; lỗi có mã → xoá dấu', async () => {
    const s = setup();
    s.meta.fail.finishReel = [new MetaError('Không gọi được Meta (lỗi mạng)', { transient: true })];
    await s.worker.tick();
    expect(s.fb().finishSentAt).not.toBeNull();
    s.advance(5000);
    s.meta.status = { phase: 'uploading' };
    await s.worker.tick();
    expect(count(s, 'uploadReel')).toBe(1);
    expect(count(s, 'finishReel')).toBe(1);
    const s2 = setup();
    s2.meta.fail.finishReel = [new MetaError('Meta báo lỗi 100: x', { transient: false, code: 100 })];
    await s2.worker.tick();
    expect(s2.fb()).toMatchObject({ status: 'failed', finishSentAt: null });
  });

  it('finishReel lỗi có mã nhưng mơ hồ (mã 1/2, HTTP 5xx, transient) → giữ finishSentAt; chỉ lỗi có mã không transient mới xoá dấu', async () => {
    for (const err of [new MetaError('Meta báo lỗi 1: x', { transient: true, code: 1 }), transient(), new MetaError('Meta báo lỗi 100: HTTP 502', { transient: true, code: 100 })]) {
      const s = setup();
      s.meta.fail.finishReel = [err];
      await s.worker.tick();
      expect(s.fb().finishSentAt).not.toBeNull();
    }
  });

  it('quá hạn sau finish → Thử lại gia hạn một khoảng chờ mới; Meta còn processing thì vẫn publishing, rồi published', async () => {
    const s = setup();
    await s.worker.tick();
    s.advance(2 * HOUR);
    s.meta.status = { phase: 'processing' };
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1' });
    expect(s.fb().finishSentAt).not.toBeNull();
    s.tx((u) => retryPost(u, s.fb().id));
    expect(s.fb().finishRetriedAt).not.toBeNull();
    await s.worker.tick();
    expect(s.fb().status).toBe('publishing');
    s.advance(5000);
    s.meta.status = { phase: 'published', permalink: 'https://fb/reel/VID1' };
    await s.worker.tick();
    expect(s.fb().status).toBe('published');
    expect(count(s, 'startReel')).toBe(1);
  });

  it('vòng đầy đủ: finish lỗi mạng → Meta kẹt uploading → quá hạn → failed → Thử lại → finish lại cùng video id → published, startReel 1 lần', async () => {
    const s = setup();
    s.meta.fail.finishReel = [new MetaError('Không gọi được Meta (lỗi mạng)', { transient: true })];
    await s.worker.tick();
    s.meta.status = { phase: 'uploading' };
    s.advance(5000);
    await s.worker.tick();
    expect(count(s, 'finishReel')).toBe(1);
    s.advance(2 * HOUR);
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1' });
    s.tx((u) => retryPost(u, s.fb().id));
    await s.worker.tick();
    expect(count(s, 'finishReel')).toBe(2);
    expect(s.meta.calls.filter((c) => c.fn === 'finishReel').every((c) => (c.args[2] as { videoId: string }).videoId === 'VID1')).toBe(true);
    expect(s.fb().status).toBe('publishing');
    s.advance(5000);
    s.meta.status = { phase: 'published', permalink: 'https://fb/reel/VID1' };
    await s.worker.tick();
    expect(s.fb().status).toBe('published');
    expect(count(s, 'startReel')).toBe(1);
  });

  it('lỗi giữa chừng upload (chưa finish) vẫn dùng lại video id, không start lại', async () => {
    const s = setup();
    s.meta.fail.uploadReel = [new MetaError('Meta báo lỗi 100: x', { transient: false, code: 100 })];
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1', finishSentAt: null });
    s.tx((u) => retryPost(u, s.fb().id));
    s.meta.status = { phase: 'uploading' };
    await s.worker.tick();
    expect(count(s, 'startReel')).toBe(1);
    expect(count(s, 'uploadReel')).toBe(2);
    expect(count(s, 'finishReel')).toBe(1);
  });
});

describe('giờ hẹn quá gần lúc sắp finish', () => {
  it('đồng hồ trôi qua mốc 10 phút trong lúc upload → không finishReel, failed rõ lý do, giờ hẹn giữ nguyên', async () => {
    const at = T0 + MIN + 60_000;
    const s = setup({}, schedAt(MIN + 60_000));
    const upload = s.meta.uploadReel.bind(s.meta);
    s.meta.uploadReel = async (...a: Parameters<FakeMeta['uploadReel']>) => {
      await upload(...a);
      s.advance(2 * 60_000);
    };
    await s.worker.tick();
    expect(count(s, 'finishReel')).toBe(0);
    expect(s.fb()).toMatchObject({ status: 'failed', scheduledAt: at, platformPostId: 'VID1', finishSentAt: null });
    expect(s.fb().error).toContain('đã qua hoặc còn dưới 10 phút');
  });

  it('giờ hẹn đã quá gần ngay đầu nhánh start → không gọi Meta', async () => {
    const s = setup({}, schedAt(HOUR));
    s.advance(HOUR - 5 * 60_000);
    await s.worker.tick();
    expect(s.meta.calls).toEqual([]);
    expect(s.fb().status).toBe('failed');
    expect(s.fb().error).toContain('đã qua hoặc còn dưới 10 phút');
  });
});

describe('retryPost kiểm giờ và nhận when', () => {
  const failTooSoon = async () => {
    const s = setup({}, schedAt(HOUR));
    s.advance(HOUR - 5 * 60_000);
    await s.worker.tick();
    return s;
  };
  const status = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return e instanceof ApprovalError ? e.code : -1;
    }
    return 0;
  };

  it('giờ hẹn hỏng không kèm when → 400', async () => {
    const s = await failTooSoon();
    expect(status(() => s.tx((u) => retryPost(u, s.fb().id)))).toBe(400);
    expect(s.fb().status).toBe('failed');
  });
  it('when.schedule ngoài 10 phút–30 ngày → 400', async () => {
    const s = await failTooSoon();
    const now = () => s.deps.clock!() ;
    expect(status(() => s.tx((u) => retryPost(u, s.fb().id, { mode: 'schedule', at: now() + 5 * 60_000 })))).toBe(400);
    expect(status(() => s.tx((u) => retryPost(u, s.fb().id, { mode: 'schedule', at: now() + 31 * 24 * HOUR })))).toBe(400);
    expect(s.fb().status).toBe('failed');
  });
  it('when.schedule hợp lệ → đổi scheduledAt, sang publishing; when.now → scheduledAt null', async () => {
    const s = await failTooSoon();
    const at = s.deps.clock!() + 2 * HOUR;
    s.tx((u) => retryPost(u, s.fb().id, { mode: 'schedule', at }));
    expect(s.fb()).toMatchObject({ status: 'publishing', scheduledAt: at, error: null });
    await s.worker.tick();
    expect(s.meta.calls.find((c) => c.fn === 'finishReel')!.args[2]).toMatchObject({ state: 'SCHEDULED', scheduledPublishTime: Math.floor(at / 1000) });

    const s2 = await failTooSoon();
    s2.tx((u) => retryPost(u, s2.fb().id, { mode: 'now' }));
    expect(s2.fb()).toMatchObject({ status: 'publishing', scheduledAt: null });
    await s2.worker.tick();
    expect(s2.meta.calls.find((c) => c.fn === 'finishReel')!.args[2]).toMatchObject({ state: 'PUBLISHED' });
  });
  it('bài đã gửi finish: bỏ qua kiểm giờ; kèm when → 409', async () => {
    const s = setup({}, schedAt(HOUR));
    await s.worker.tick();
    s.advance(HOUR + 2 * HOUR); // quá giờ hẹn + hạn chót
    s.meta.status = { phase: 'scheduled' };
    await s.worker.tick();
    expect(s.fb().status).toBe('failed');
    expect(status(() => s.tx((u) => retryPost(u, s.fb().id, { mode: 'now' })))).toBe(409);
    expect(status(() => s.tx((u) => retryPost(u, s.fb().id)))).toBe(0);
  });
});

describe('hạn chót xác nhận lịch', () => {
  it('Meta vẫn scheduled quá giờ hẹn + 1 giờ → failed; Thử lại chỉ hỏi lại trạng thái', async () => {
    const s = setup({}, schedAt(HOUR));
    await s.worker.tick();
    s.advance(2000);
    s.meta.status = { phase: 'scheduled' };
    await s.worker.tick();
    expect(s.fb().status).toBe('scheduled');
    s.advance(HOUR); // tới giờ
    await s.worker.tick(); // scheduled → publishing, rồi hỏi
    s.advance(30 * 60_000);
    await s.worker.tick();
    expect(s.fb().status).toBe('publishing'); // chưa quá hạn chót
    s.advance(HOUR);
    await s.worker.tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1' });
    expect(s.fb().error).toBe('Meta chưa xác nhận đã đăng — kiểm tra Meta Business Suite');
    const before = s.meta.calls.length;
    s.tx((u) => retryPost(u, s.fb().id));
    await s.worker.tick();
    expect(s.meta.calls.slice(before).map((c) => c.fn)).toEqual(['reelStatus']);
    expect(count(s, 'startReel')).toBe(1);
    expect(count(s, 'uploadReel')).toBe(1);
    expect(count(s, 'finishReel')).toBe(1);
  });
});

describe('dấu finish bền vững (restart)', () => {
  const restart = (s: ReturnType<typeof setup>) => new PublishWorker(s.deps, s.meta, new Accounts(s.deps, s.meta, 8787), { videoDir: s.videoDir, pollMs: 1000, backoffMs: 1000 });

  it('worker mới trên cùng DB, Meta còn báo uploading → không uploadReel/finishReel lần hai', async () => {
    const s = setup();
    await s.worker.tick();
    expect(s.fb().finishSentAt).not.toBeNull();
    s.advance(5000);
    s.meta.status = { phase: 'uploading' };
    const w2 = restart(s);
    await w2.tick();
    expect(count(s, 'startReel')).toBe(1);
    expect(count(s, 'uploadReel')).toBe(1);
    expect(count(s, 'finishReel')).toBe(1);
    expect(s.fb().status).toBe('publishing');
  });

  it('sau restart, uploading quá 1 giờ kể từ dấu → failed, giữ video id; Thử lại không start video mới', async () => {
    const s = setup();
    await s.worker.tick();
    s.advance(HOUR + 5000);
    s.meta.status = { phase: 'uploading' };
    await restart(s).tick();
    expect(s.fb()).toMatchObject({ status: 'failed', platformPostId: 'VID1' });
    expect(s.fb().finishSentAt).not.toBeNull();
    s.tx((u) => retryPost(u, s.fb().id));
    await restart(s).tick();
    expect(count(s, 'startReel')).toBe(1);
  });
});

describe('Instagram qua API', () => {
  function igSetup(when: Record<string, unknown> = { mode: 'now' }, o: SetupOpts = {}) {
    const s = setup({ platforms: ['instagram'], instagram: true, ...o }, { posts: [{ platform: 'instagram', enabled: true, caption: 'Caption IG #x' }], when });
    const ig = () => s.db.select().from(posts).where(eq(posts.id, s.post('instagram').id)).get()!;
    return { ...s, ig };
  }

  it('tạo container (caption) → tải tệp cục bộ → FINISHED → media_publish → published, lưu permalink; bước đăng done', async () => {
    const s = igSetup();
    await s.worker.tick();
    expect(s.meta.names()).toEqual(['createIgReel', 'uploadIgReel']);
    expect(s.meta.calls[0]!.args).toEqual(['IG1', expect.any(String), 'Caption IG #x']);
    expect(s.meta.calls[1]!.args[2]).toEqual({ path: join(s.videoDir, 'VV-OK.mp4'), size: 1234 });
    expect(s.ig()).toMatchObject({ status: 'publishing', platformPostId: 'CT1', uploadedAt: expect.any(Number) });
    s.advance(2000);
    await s.worker.tick(); // IN_PROGRESS: chờ
    expect(s.ig().status).toBe('publishing');
    s.advance(2000);
    s.meta.igStatus = { status: 'FINISHED' };
    await s.worker.tick();
    expect(s.meta.names().slice(-3)).toEqual(['igContainerStatus', 'publishIgReel', 'igPermalink']);
    expect(s.ig()).toMatchObject({ status: 'published', permalink: 'https://www.instagram.com/reel/MED-CT1/', error: null });
    expect(s.stage('publishing').status).toBe('done');
    expect(s.meta.names().filter((n) => n === 'createIgReel')).toHaveLength(1);
  });

  it('tải lên lỗi tạm thời → tự thử lại vào cùng container, không tạo container mới', async () => {
    const s = igSetup();
    s.meta.fail.uploadIgReel = [transient()];
    await s.worker.tick();
    expect(s.ig()).toMatchObject({ status: 'publishing', retries: 1, platformPostId: 'CT1', uploadedAt: null });
    s.advance(5000);
    await s.worker.tick();
    expect(s.meta.names()).toEqual(['createIgReel', 'uploadIgReel', 'uploadIgReel']);
    expect(s.meta.calls[2]!.args[0]).toBe('CT1');
    expect(s.ig().uploadedAt).not.toBeNull();
  });

  it('đã gửi media_publish (sập ngay sau đó) → không gửi lại; Instagram báo PUBLISHED → published', async () => {
    const s = igSetup();
    await s.worker.tick();
    s.advance(2000);
    s.meta.igStatus = { status: 'FINISHED' };
    s.meta.fail.publishIgReel = [new MetaError('Không gọi được Meta (lỗi mạng)', { transient: true })];
    await s.worker.tick();
    expect(s.ig()).toMatchObject({ status: 'publishing', finishSentAt: expect.any(Number) });
    s.advance(5000);
    await s.worker.tick(); // vẫn FINISHED, đã gửi publish: chờ, không gửi lần hai
    expect(s.meta.names().filter((n) => n === 'publishIgReel')).toHaveLength(1);
    s.advance(5000);
    s.meta.igStatus = { status: 'PUBLISHED' };
    await s.worker.tick();
    expect(s.ig().status).toBe('published');
    expect(s.meta.names().filter((n) => n === 'publishIgReel')).toHaveLength(1);
  });

  it('container ERROR → failed, bỏ container; Thử lại tạo container mới', async () => {
    const s = igSetup();
    await s.worker.tick();
    s.advance(2000);
    s.meta.igStatus = { status: 'ERROR', error: 'video quá dài' };
    await s.worker.tick();
    expect(s.ig()).toMatchObject({ status: 'failed', platformPostId: null, uploadedAt: null });
    expect(s.ig().error).toContain('video quá dài');
    s.tx((u) => retryPost(u, s.ig().id));
    s.meta.igStatus = { status: 'IN_PROGRESS' };
    await s.worker.tick();
    expect(s.ig().platformPostId).toBe('CT2');
  });

  it('hết hạn mức 50 bài/24 giờ → failed, không gọi API', async () => {
    const s = igSetup();
    for (let i = 0; i < 50; i++) s.db.insert(posts).values({ ...s.ig(), id: `OLD${i}`, status: 'published', apiCalledAt: T0 }).run();
    await s.worker.tick();
    expect(s.ig().status).toBe('failed');
    expect(s.ig().error).toContain('50 bài/24 giờ');
    expect(s.meta.names()).toEqual([]);
  });

  it('hẹn giờ: chờ tới giờ mới tạo container; máy tắt quá giờ → đăng khi bật lại và báo trễ trong chat Director', async () => {
    const at = T0 + HOUR;
    const s = igSetup({ mode: 'schedule', at });
    await s.worker.tick();
    expect(s.ig().status).toBe('scheduled');
    expect(s.meta.names()).toEqual([]);
    s.advance(3 * HOUR);
    await s.worker.tick();
    expect(s.meta.names()).toEqual(['createIgReel', 'uploadIgReel']);
    const notes = s.db.select().from(messages).all().map((m) => JSON.stringify(m));
    expect(notes.some((m) => m.includes('đăng trễ'))).toBe(true);
  });

  it('token hết hạn (190) → failed, Page và IG đánh dấu expired; lỗi không chứa token', async () => {
    const s = igSetup();
    s.meta.fail.createIgReel = [new MetaError(`Meta báo lỗi 190: expired ${'EAAFAKEPAGETOKEN1234567890secret'}`, { transient: false, code: 190, tokenExpired: true })];
    await s.worker.tick();
    expect(s.ig().status).toBe('failed');
    expect(s.ig().error).not.toContain('EAAFAKEPAGETOKEN');
    expect(s.db.select().from(socialAccounts).all().map((a) => a.status).sort()).toEqual(['expired', 'expired']);
  });
});
