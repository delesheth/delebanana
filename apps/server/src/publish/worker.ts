// Worker đăng bài: mỗi tick (a) đăng bài Facebook/Instagram đang `publishing` qua MetaClient (gọi mạng NGOÀI giao dịch SQLite),
// (b) đưa bài API tới giờ hẹn về `publishing` (Facebook: Meta giữ lịch, chỉ xác nhận; Instagram: máy này giữ lịch, đăng lúc đó),
// (c) nhắc đúng một lần các bài đăng tay tới giờ hẹn. Đồng hồ và client tiêm được.

import { FB_REELS_DAILY_LIMIT, FB_SCHEDULE_MIN_MS, IG_REELS_DAILY_LIMIT, MAX_PUBLISH_RETRIES, PLATFORM_LABELS, checkReelsSpec, type VideoProbe } from '@delebanana/domain';
import { and, eq, gt, isNull, lte, ne } from 'drizzle-orm';
import { basename, join } from 'node:path';
import { notifyDirector } from '../agents/usage.ts';
import { settlePublishing } from '../campaign/publishing.ts';
import { runTx, type Deps, type UnitOfWork } from '../core/unitOfWork.ts';
import { campaigns, posts, videoVersions } from '../db/schema.ts';
import { Accounts, scrub } from './accounts.ts';
import { MetaError, type MetaClient } from './meta.ts';

const DAY_MS = 24 * 3_600_000;
/** Chờ giữa hai lần hỏi trạng thái xử lý video, và giữa các lần tự thử lại (nhân số lần đã thử). */
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_BACKOFF_MS = 30_000;
/** Video xử lý quá lâu ở Meta thì coi là lỗi. */
const PROCESSING_TIMEOUT_MS = 60 * 60_000;
/** Meta giữ lịch mà quá giờ hẹn chừng này vẫn chưa báo đã đăng thì thôi hỏi, để người dùng tự kiểm tra. */
const SCHEDULE_CONFIRM_GRACE_MS = 60 * 60_000;
const TIMEOUT_AFTER_FINISH = 'Meta chưa xử lý xong video sau khi gửi finish (hơn 1 giờ) — kiểm tra Meta Business Suite xem bài đã lên chưa; Thử lại chỉ hỏi lại trạng thái video cũ, không đăng video mới';
const IG_TIMEOUT_AFTER_PUBLISH = 'Instagram chưa xác nhận đã đăng sau khi gửi lệnh đăng (hơn 1 giờ) — kiểm tra tài khoản Instagram xem bài đã lên chưa; Thử lại chỉ hỏi lại trạng thái, gửi lệnh đăng lại nếu Instagram vẫn chưa đăng';
/** Bài Instagram hẹn giờ mà bắt đầu đăng trễ hơn chừng này (máy tắt lúc tới giờ) thì báo trễ trong chat Director. */
const IG_LATE_MS = 5 * 60_000;
const SCHEDULE_TOO_SOON = 'Giờ hẹn Facebook đã qua hoặc còn dưới 10 phút — chọn Đăng ngay hoặc đổi giờ hẹn rồi bấm Thử lại';

type PostRow = typeof posts.$inferSelect;

export interface WorkerOptions {
  videoDir: string;
  pollMs?: number;
  backoffMs?: number;
}

class PostFailure extends Error {
  readonly transient: boolean;
  readonly tokenExpired: boolean;
  /** Video phía Meta hỏng/quá hạn: bỏ video id để Thử lại start video mới. */
  readonly discardVideo: boolean;
  constructor(message: string, transient: boolean, tokenExpired = false, discardVideo = false) {
    super(message);
    this.transient = transient;
    this.tokenExpired = tokenExpired;
    this.discardVideo = discardVideo;
  }
}

export class PublishWorker {
  private busy = new Set<string>();
  /** Post chưa được đụng tới trước thời điểm này (ms): chờ giữa hai lần hỏi trạng thái / giữa các lần thử lại. */
  private notBefore = new Map<string, number>();
  private pollMs: number;
  private backoffMs: number;
  private deps: Deps;
  private client: MetaClient;
  private accounts: Accounts;
  private opts: WorkerOptions;

  constructor(deps: Deps, client: MetaClient, accounts: Accounts, opts: WorkerOptions) {
    this.deps = deps;
    this.client = client;
    this.accounts = accounts;
    this.opts = opts;
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  private now() {
    return this.deps.clock?.() ?? Date.now();
  }

  /** Một vòng việc; trả khi mọi bài đang xử lý xong (kiểm thử `await`). */
  async tick(): Promise<void> {
    const now = this.now();
    this.dueScheduled(now);
    this.remind(now);
    const todo = this.deps.db.select().from(posts).where(and(eq(posts.status, 'publishing'), eq(posts.mode, 'api'))).all().filter((p) => !this.busy.has(p.id) && (this.notBefore.get(p.id) ?? 0) <= now);
    await Promise.all(
      todo.map(async (p) => {
        this.busy.add(p.id);
        try {
          await this.publish(p.id);
        } catch (e) {
          console.error('Worker đăng bài lỗi:', scrub(e instanceof Error ? e.message : String(e)));
        } finally {
          this.busy.delete(p.id);
        }
      }),
    );
  }

  /** Bài Meta giữ lịch đã tới giờ → publishing để hỏi Meta đã đăng chưa. */
  private dueScheduled(now: number) {
    const due = this.deps.db.select().from(posts).where(and(eq(posts.status, 'scheduled'), eq(posts.mode, 'api'), lte(posts.scheduledAt, now))).all();
    for (const p of due) runTx(this.deps, (u) => u.transition({ entity: 'post', id: p.id, to: 'publishing', actor: 'system', ctx: { retries: p.retries, mode: p.mode } }));
  }

  /** Đăng tay: tới giờ hẹn thì nhắc đúng một lần. */
  private remind(now: number) {
    const due = this.deps.db.select().from(posts).where(and(eq(posts.status, 'scheduled'), eq(posts.mode, 'manual'), isNull(posts.remindedAt), lte(posts.scheduledAt, now))).all();
    for (const p of due) {
      runTx(this.deps, (u) => {
        const fresh = u.tx.select().from(posts).where(eq(posts.id, p.id)).get();
        if (!fresh || fresh.status !== 'scheduled' || fresh.remindedAt) return;
        u.tx.update(posts).set({ remindedAt: u.now }).where(eq(posts.id, p.id)).run();
        const c = u.tx.select().from(campaigns).where(eq(campaigns.id, p.campaignId)).get()!;
        notifyDirector(u, c.workspaceId, `Đến giờ đăng ${PLATFORM_LABELS[p.platform as keyof typeof PLATFORM_LABELS] ?? p.platform} cho "${c.title}". Mở danh sách bài đăng để sao chép caption, tải video và đăng.`, c.id);
      });
    }
  }

  private async publish(postId: string): Promise<void> {
    const db = this.deps.db;
    const p = db.select().from(posts).where(eq(posts.id, postId)).get();
    if (!p || p.status !== 'publishing') return;
    try {
      await this.run(p);
    } catch (e) {
      const f =
        e instanceof PostFailure
          ? e
          : e instanceof MetaError
            ? new PostFailure(e.message, e.transient, e.tokenExpired)
            : new PostFailure(`Lỗi không rõ khi đăng: ${e instanceof Error ? e.name : 'unknown'}`, false);
      this.fail(p, f);
    }
  }

  private context(p: PostRow) {
    const db = this.deps.db;
    const name = p.platform === 'instagram' ? 'Instagram' : 'Facebook';
    if (!p.socialAccountId) throw new PostFailure(`Bài chưa gắn tài khoản ${name}`, false);
    const token = this.accounts.accessToken(p.socialAccountId);
    const account = this.accounts.listAccounts().find((a) => a.id === p.socialAccountId);
    if (!token || !account) throw new PostFailure(`${name} chưa kết nối — vào màn Kết nối tài khoản`, false);
    if (account.status === 'expired') throw new PostFailure(`Token ${name} đã hết hạn — kết nối lại Page rồi bấm Thử lại`, false, true);
    const v = db.select().from(videoVersions).where(eq(videoVersions.id, p.videoVersionId)).get();
    return { token, account, video: v };
  }

  private async run(p: PostRow): Promise<void> {
    if (p.platform === 'instagram') return this.runInstagram(p);
    const { token, account, video } = this.context(p);
    const pageId = account.externalId;
    const now = this.now();

    // Đã có video id (đã start trước đó): hỏi trạng thái trước để không đăng trùng.
    if (p.platformPostId) {
      const st = await this.client.reelStatus(p.platformPostId, token);
      if (st.phase === 'published') return this.setResult(p, 'published', st.permalink);
      if (st.phase === 'scheduled') {
        if (p.scheduledAt && p.scheduledAt > now) return this.setResult(p, 'scheduled', st.permalink);
        if (p.scheduledAt && now > p.scheduledAt + SCHEDULE_CONFIRM_GRACE_MS) throw new PostFailure('Meta chưa xác nhận đã đăng — kiểm tra Meta Business Suite', false);
        // Tới giờ nhưng Meta chưa chuyển sang đã đăng: chờ lần hỏi sau.
        this.notBefore.set(p.id, now + this.pollMs);
        if (st.permalink) this.deps.db.update(posts).set({ permalink: st.permalink }).where(eq(posts.id, p.id)).run();
        return;
      }
      if (st.phase === 'error') throw new PostFailure(`Meta báo lỗi xử lý video: ${st.error ?? 'không rõ'}`, false, false, true);
      if (st.phase === 'processing') {
        // Hạn tính từ mốc gần nhất (start, finish hoặc lần Thử lại của người dùng): Thử lại bài tải dở rồi finish không bị tính theo lần start cũ.
        const since = Math.max(p.apiCalledAt ?? 0, p.finishSentAt ?? 0, p.finishRetriedAt ?? 0);
        if (since && now - since > PROCESSING_TIMEOUT_MS) {
          // Đã gửi finish thì video cũ vẫn có thể được Meta đăng muộn: giữ id để Thử lại chỉ hỏi lại trạng thái, không start video mới.
          if (p.finishSentAt) throw new PostFailure(TIMEOUT_AFTER_FINISH, false);
          throw new PostFailure('Meta xử lý video quá lâu (hơn 1 giờ)', false, false, true);
        }
        this.notBefore.set(p.id, now + this.pollMs);
        return;
      }
      if (p.finishSentAt) {
        // Người dùng đã Thử lại sau khi quá hạn mà Meta vẫn 'uploading' = Meta chưa nhận finish: finish lại trên cùng video id (không startReel).
        if (p.finishRetriedAt && p.finishRetriedAt >= p.finishSentAt) return this.upload(p, pageId, token, video, p.platformPostId, undefined);
        // Đã gửi finish (dấu bền vững, sống qua restart): Meta chưa kịp báo upload xong thì chờ, không tải lại hay finish lần hai.
        if (now - p.finishSentAt > PROCESSING_TIMEOUT_MS) throw new PostFailure(TIMEOUT_AFTER_FINISH, false);
        this.notBefore.set(p.id, now + this.pollMs);
        return;
      }
      // uploading, chưa gửi finish: tệp chưa lên đủ → tải lại rồi finish, dùng lại video id.
      return this.upload(p, pageId, token, video, p.platformPostId, undefined);
    }

    const reasons = checkReelsSpec((video?.metadata ?? {}) as VideoProbe, video?.mime);
    if (!video || !video.path || reasons.length > 0) throw new PostFailure(`Video không đạt thông số Facebook Reels: ${(video ? reasons : ['không tìm thấy video']).join('; ')}`, false);

    if (p.scheduledAt != null && p.scheduledAt < now + FB_SCHEDULE_MIN_MS) throw new PostFailure(SCHEDULE_TOO_SOON, false);

    // Hạn mức 30 bài Reels/24 giờ cuốn chiếu cho mỗi Page: backend tự đếm, bài vượt hạn mức không gọi API.
    const used = this.deps.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.socialAccountId, account.id), eq(posts.platform, 'facebook'), gt(posts.apiCalledAt, now - DAY_MS), ne(posts.id, p.id)))
      .all().length;
    if (used >= FB_REELS_DAILY_LIMIT) throw new PostFailure(`Hết hạn mức ${FB_REELS_DAILY_LIMIT} Reels/24 giờ của Page "${account.displayName}" qua API — đợi hạn mức hồi rồi bấm Thử lại`, false);

    this.deps.db.update(posts).set({ apiCalledAt: now }).where(eq(posts.id, p.id)).run();
    const started = await this.client.startReel(pageId, token);
    // Lưu video id ngay: thử lại sau lỗi giữa chừng sẽ hỏi trạng thái thay vì start lại.
    this.deps.db.update(posts).set({ platformPostId: started.videoId }).where(eq(posts.id, p.id)).run();
    await this.upload(p, pageId, token, video, started.videoId, started.uploadUrl);
  }

  private async upload(p: PostRow, pageId: string, token: string, video: typeof videoVersions.$inferSelect | undefined, videoId: string, uploadUrl: string | undefined) {
    if (!video?.path) throw new PostFailure('Không tìm thấy tệp video để tải lên', false);
    const path = join(this.opts.videoDir, basename(video.path));
    await this.client.uploadReel(videoId, token, { path, size: video.sizeBytes ?? 0 }, uploadUrl);
    const scheduled = p.scheduledAt != null;
    // Upload có thể mất lâu: giờ hẹn đã trôi gần/qua mốc tối thiểu thì không finish (Meta sẽ từ chối hoặc đăng sai giờ).
    if (scheduled && p.scheduledAt! < this.now() + FB_SCHEDULE_MIN_MS) throw new PostFailure(SCHEDULE_TOO_SOON, false);
    // Ghi dấu TRƯỚC khi gọi: sập giữa lúc gọi thì lần chạy sau không finish lại (tránh đăng trùng).
    this.deps.db.update(posts).set({ finishSentAt: this.now() }).where(eq(posts.id, p.id)).run();
    try {
      await this.client.finishReel(pageId, token, {
        videoId,
        state: scheduled ? 'SCHEDULED' : 'PUBLISHED',
        description: p.caption,
        ...(scheduled ? { scheduledPublishTime: Math.floor(p.scheduledAt! / 1000) } : {}),
        aiGenerated: true,
      });
    } catch (e) {
      // Chỉ lỗi Meta có mã và không tạm thời mới chắc là chưa nhận finish → cho phép tải lại + finish ở lần thử sau.
      // Lỗi mạng/timeout (không mã), mã 1/2, HTTP 5xx hay mọi lỗi transient mơ hồ: Meta có thể đã nhận, giữ dấu và chờ hỏi trạng thái.
      if (e instanceof MetaError && e.code !== undefined && !e.transient) this.deps.db.update(posts).set({ finishSentAt: null }).where(eq(posts.id, p.id)).run();
      throw e;
    }
    // Theo dõi xử lý: kết quả cuối ghi ở lần hỏi trạng thái tiếp theo (tick sau), không chặn worker.
    this.notBefore.set(p.id, this.now() + this.pollMs);
  }

  /**
   * Instagram: tạo container REELS resumable → tải tệp (dấu `uploadedAt`) → hỏi `status_code` ở các tick sau → FINISHED thì ghi
   * `finishSentAt` rồi gửi media_publish. Container id lưu ở `platformPostId` ngay khi tạo; mọi lần chạy lại hỏi trạng thái trước.
   */
  private async runInstagram(p: PostRow): Promise<void> {
    const { token, account, video } = this.context(p);
    const igId = account.externalId;
    const now = this.now();

    if (p.platformPostId) {
      const containerId = p.platformPostId;
      if (!p.uploadedAt) return this.uploadIg(p, token, video, containerId, undefined);
      const st = await this.client.igContainerStatus(containerId, token);
      if (st.status === 'PUBLISHED') return this.setResult(p, 'published');
      if (st.status === 'ERROR' || st.status === 'EXPIRED')
        throw new PostFailure(`Instagram báo lỗi xử lý video${st.status === 'EXPIRED' ? ' (container hết hạn)' : ''}: ${st.error ?? 'không rõ'}`, false, false, true);
      if (st.status === 'IN_PROGRESS') {
        const since = Math.max(p.apiCalledAt ?? 0, p.finishRetriedAt ?? 0);
        if (since && now - since > PROCESSING_TIMEOUT_MS) throw new PostFailure('Instagram xử lý video quá lâu (hơn 1 giờ)', false, false, true);
        this.notBefore.set(p.id, now + this.pollMs);
        return;
      }
      // FINISHED: đã gửi lệnh đăng thì chờ Instagram chuyển PUBLISHED, trừ khi người dùng bấm Thử lại sau đó.
      if (p.finishSentAt && !(p.finishRetriedAt && p.finishRetriedAt >= p.finishSentAt)) {
        if (now - p.finishSentAt > PROCESSING_TIMEOUT_MS) throw new PostFailure(IG_TIMEOUT_AFTER_PUBLISH, false);
        this.notBefore.set(p.id, now + this.pollMs);
        return;
      }
      return this.publishIg(p, igId, token, containerId);
    }

    const reasons = checkReelsSpec((video?.metadata ?? {}) as VideoProbe, video?.mime, 'Instagram Reels');
    if (!video || !video.path || reasons.length > 0) throw new PostFailure(`Video không đạt thông số Instagram Reels: ${(video ? reasons : ['không tìm thấy video']).join('; ')}`, false);

    const used = this.deps.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.socialAccountId, account.id), eq(posts.platform, 'instagram'), gt(posts.apiCalledAt, now - DAY_MS), ne(posts.id, p.id)))
      .all().length;
    if (used >= IG_REELS_DAILY_LIMIT) throw new PostFailure(`Hết hạn mức ${IG_REELS_DAILY_LIMIT} bài/24 giờ của Instagram ${account.displayName} qua API — đợi hạn mức hồi rồi bấm Thử lại`, false);

    // Máy tắt lúc tới giờ hẹn: vẫn đăng ngay khi bật lại, báo trễ một lần.
    if (p.scheduledAt != null && !p.apiCalledAt && now > p.scheduledAt + IG_LATE_MS) {
      runTx(this.deps, (u) => {
        const c = u.tx.select().from(campaigns).where(eq(campaigns.id, p.campaignId)).get()!;
        const late = Math.round((now - p.scheduledAt!) / 60_000);
        notifyDirector(u, c.workspaceId, `Bài Instagram của "${c.title}" đăng trễ ${late} phút so với giờ hẹn (máy không bật lúc tới giờ). Đang đăng ngay bây giờ.`, c.id);
      });
    }

    this.deps.db.update(posts).set({ apiCalledAt: now }).where(eq(posts.id, p.id)).run();
    const created = await this.client.createIgReel(igId, token, p.caption);
    // Lưu container id ngay: lỗi giữa chừng thì lần sau tải lại vào cùng container thay vì tạo bài mới.
    this.deps.db.update(posts).set({ platformPostId: created.containerId, uploadedAt: null }).where(eq(posts.id, p.id)).run();
    await this.uploadIg(p, token, video, created.containerId, created.uploadUrl);
  }

  private async uploadIg(p: PostRow, token: string, video: typeof videoVersions.$inferSelect | undefined, containerId: string, uploadUrl: string | undefined) {
    if (!video?.path) throw new PostFailure('Không tìm thấy tệp video để tải lên', false);
    await this.client.uploadIgReel(containerId, token, { path: join(this.opts.videoDir, basename(video.path)), size: video.sizeBytes ?? 0 }, uploadUrl);
    this.deps.db.update(posts).set({ uploadedAt: this.now() }).where(eq(posts.id, p.id)).run();
    // Instagram xử lý video: hỏi trạng thái ở tick sau.
    this.notBefore.set(p.id, this.now() + this.pollMs);
  }

  private async publishIg(p: PostRow, igId: string, token: string, containerId: string) {
    // Ghi dấu TRƯỚC khi gọi: sập giữa lúc gọi thì lần chạy sau chỉ hỏi trạng thái, không gửi lệnh đăng lần hai.
    this.deps.db.update(posts).set({ finishSentAt: this.now() }).where(eq(posts.id, p.id)).run();
    let mediaId: string;
    try {
      mediaId = await this.client.publishIgReel(igId, token, containerId);
    } catch (e) {
      // Như finish của Facebook: chỉ lỗi có mã và không tạm thời mới chắc là Instagram chưa nhận lệnh đăng.
      if (e instanceof MetaError && e.code !== undefined && !e.transient) this.deps.db.update(posts).set({ finishSentAt: null }).where(eq(posts.id, p.id)).run();
      throw e;
    }
    let permalink: string | undefined;
    try {
      permalink = await this.client.igPermalink(mediaId, token);
    } catch {
      // Bài đã lên; thiếu link không làm hỏng kết quả.
    }
    this.setResult(p, 'published', permalink);
  }

  private setResult(p: PostRow, to: 'published' | 'scheduled', permalink?: string) {
    runTx(this.deps, (u) => {
      u.tx.update(posts).set({ error: null, ...(permalink ? { permalink } : {}), ...(to === 'published' ? { publishedAt: u.now } : {}) }).where(eq(posts.id, p.id)).run();
      u.transition({ entity: 'post', id: p.id, to, actor: 'system', ctx: { retries: p.retries, mode: p.mode } });
      if (to === 'published') settlePublishing(u, p.campaignId);
    });
    this.notBefore.delete(p.id);
  }

  /** Lỗi tạm thời: tự thử lại tối đa MAX_PUBLISH_RETRIES lần; lỗi không tạm thời hoặc hết lượt: failed chờ người dùng. */
  private fail(p: PostRow, f: PostFailure) {
    const message = scrub(f.message, [this.p2token(p), this.accounts.appCredentials()?.appSecret]);
    const retry = f.transient && p.retries < MAX_PUBLISH_RETRIES;
    runTx(this.deps, (u) => {
      u.tx.update(posts).set({ error: message, ...(retry ? { retries: p.retries + 1 } : {}), ...(f.discardVideo ? { platformPostId: null, finishSentAt: null, finishRetriedAt: null, uploadedAt: null } : {}) }).where(eq(posts.id, p.id)).run();
      u.transition({ entity: 'post', id: p.id, to: 'failed', actor: 'system', ctx: { retries: p.retries, mode: p.mode } });
      if (retry) u.transition({ entity: 'post', id: p.id, to: 'publishing', actor: 'system', ctx: { retries: p.retries, mode: p.mode } });
      else this.notifyFailure(u, p, message);
    });
    if (f.tokenExpired && p.socialAccountId) this.accounts.markExpired(p.socialAccountId);
    if (retry) this.notBefore.set(p.id, this.now() + this.backoffMs * (p.retries + 1));
    else this.notBefore.delete(p.id);
  }

  private p2token(p: PostRow): string | undefined {
    return p.socialAccountId ? this.accounts.accessToken(p.socialAccountId) : undefined;
  }

  private notifyFailure(u: UnitOfWork, p: PostRow, message: string) {
    const c = u.tx.select().from(campaigns).where(eq(campaigns.id, p.campaignId)).get()!;
    notifyDirector(u, c.workspaceId, `Đăng ${PLATFORM_LABELS[p.platform as keyof typeof PLATFORM_LABELS] ?? p.platform} cho "${c.title}" không thành công: ${message}`, c.id);
  }
}
