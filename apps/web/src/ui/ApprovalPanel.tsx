// Panel duyệt Approval đang chờ. Logic gọi server nằm trong approvalStore; ở đây chỉ hiển thị và thu thập lựa chọn.

import { CAPTION_MAX_LENGTH, VIDEO_TOOLS, videoToolById, type Platform } from '@delebanana/domain';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { ApprovalRow } from '../live/api.ts';
import { campaignStore } from '../campaign/instance.ts';
import { approvalStore } from '../sim/approvalStore.ts';
import { uploadUrl } from './ChatThread.tsx';
import { buildPublishDecision, facebookBlockReason, instagramBlockReason, platformLabel, toDatetimeLocal, type CaptionDraft, type WhenDraft } from './publishUi.ts';
import { Markdown, artifactBody, artifactTitle } from './markdown.tsx';
import { afterUpload, chooseScriptVideoDecision, createVideoBlockReason, readVideoPrompt, uploadState, videoFileProblem, videoFileUrl, openTools, videoGuide, videoPromptText } from './videoUi.ts';

const KIND_LABEL: Record<string, string> = {
  choose_script: 'Chọn kịch bản',
  make_video: 'Làm video',
  approve_video: 'Duyệt video',
  approve_publish: 'Duyệt đăng',
  strategy_change: 'Đổi chiến lược',
  out_of_permission: 'Ngoài quyền hạn',
  limit_override: 'Vượt hạn mức',
};

/** Danh sách nơi tạo video (từ cấu hình VIDEO_TOOLS); chọn một nơi là gửi quyết định duyệt kèm nơi đó. */
export function VideoToolPicker({ disabled, onPick }: { disabled?: boolean; onPick: (toolId: string) => void }) {
  return (
    <ul className="video-tools">
      {VIDEO_TOOLS.map((t) => (
        <li key={t.id}>
          <button disabled={disabled} onClick={() => onPick(t.id)}>
            {t.label}
          </button>
          <span className="hint">
            {' '}
            {t.minSeconds}–{t.maxSeconds} giây · {t.aspectRatio}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MakeVideo({ a }: { a: ApprovalRow }) {
  const tool = videoToolById(String(a.subject.toolId));
  const art = a.artifacts?.[0];
  const v = readVideoPrompt(art?.content);
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const shown = tool ? openTools(tool, v.durationSeconds) : [];
  const prompt = tool ? videoPromptText(v, tool, shown) : v.text;
  const up = uploadState(a.latestVideo, tool ?? VIDEO_TOOLS[0]!);
  function pick(f: File | null) {
    setFile(f);
    setProblem(f ? videoFileProblem(f) : undefined);
  }
  async function upload() {
    if (!file || problem) return;
    setUploading(true);
    const result = await approvalStore.uploadVideo(a.id, file);
    setUploading(false);
    if (afterUpload(result).clearFile) {
      setFile(null);
      setInputKey((k) => k + 1); // Ô chọn tệp mới để chọn lại cùng tệp vẫn phát change.
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      box.current?.select(); // Không có quyền clipboard: chọn sẵn chữ để người dùng tự Ctrl/Cmd+C.
    }
  }
  if (!tool) return <p className="detail">Nơi tạo video không còn trong cấu hình: {String(a.subject.toolId)}</p>;
  return (
    <>
      <h4>Làm video ở {tool.label}</h4>
      <p className="hint">
        Clip {v.durationSeconds ?? '?'} giây · {v.aspectRatio ?? tool.aspectRatio}
      </p>
      <textarea ref={box} className="note" rows={6} readOnly value={prompt} />
      <div className="actions">
        <button onClick={() => void copy()}>{copied ? 'Đã sao chép' : 'Sao chép'}</button>
        {shown.map((t) => (
          <a key={t.id} className="button" href={t.url} target="_blank" rel="noopener noreferrer">
            Mở {t.label}
          </a>
        ))}
      </div>
      <ol className="video-guide">
        {videoGuide(shown).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {v.referenceImages.length > 0 && (
        <div className="video-refs">
          {v.referenceImages.map((im) => (
            <a key={im.id} href={uploadUrl(im.id)} target="_blank" rel="noopener noreferrer" title={im.name}>
              <img src={uploadUrl(im.id)} alt={im.name} width={96} />
            </a>
          ))}
        </div>
      )}
      <h4>Tải video lên</h4>
      <p className="hint">{up.label}</p>
      {up.reasons.length > 0 && (
        <ul className="error" role="alert">
          {up.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {up.canUpload && (
        <div className="actions">
          <input key={inputKey} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" disabled={uploading} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <button className="primary" disabled={uploading || !file || !!problem} onClick={() => void upload()}>
            {uploading ? 'Đang tải lên và kiểm tra…' : 'Tải lên'}
          </button>
        </div>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

export function ApproveVideo({ a }: { a: ApprovalRow }) {
  const [busy, setBusy] = useState(false);
  const v = a.latestVideo;
  async function decide(status: 'approved' | 'rejected') {
    setBusy(true);
    await approvalStore.decide(a.id, status);
    setBusy(false);
  }
  return (
    <>
      <p className="lead">Xem video đã tải lên (bản {v?.number ?? '?'}) rồi duyệt. Từ chối thì giữ prompt và chờ bạn tải bản mới.</p>
      {v ? <video className="video-preview" style={{ width: '100%', maxHeight: 420 }} controls preload="metadata" src={videoFileUrl(v.id)} /> : <p className="detail">Không tìm thấy video.</p>}
      <div className="actions">
        <button className="primary" disabled={busy || !v} onClick={() => void decide('approved')}>
          ✓ Duyệt video
        </button>
        <button disabled={busy || !v} onClick={() => void decide('rejected')}>
          Từ chối
        </button>
      </div>
    </>
  );
}

/** Duyệt đăng: caption sửa được từng nền tảng, chọn nền tảng, đăng ngay hoặc hẹn giờ. */
export function ApprovePublish({ a }: { a: ApprovalRow }) {
  const [drafts, setDrafts] = useState<CaptionDraft[]>(() => (a.posts ?? []).map((p) => ({ platform: p.platform as Platform, enabled: true, caption: p.caption })));
  const [when, setWhen] = useState<WhenDraft>({ mode: 'now' });
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const change = (platform: Platform, patch: Partial<CaptionDraft>) => setDrafts((ds) => ds.map((d) => (d.platform === platform ? { ...d, ...patch } : d)));
  const block = facebookBlockReason(drafts, a) ?? instagramBlockReason(drafts, a);
  const viaApi = (p: Platform) => p === 'facebook' || (p === 'instagram' && !!a.instagramAccount);
  const manual = drafts.some((d) => d.enabled && !viaApi(d.platform));
  const igApi = drafts.some((d) => d.enabled && d.platform === 'instagram') && !!a.instagramAccount;

  async function decide(status: 'approved' | 'rejected' | 'changes_requested') {
    setProblem(undefined);
    let decision: Record<string, unknown> = {};
    if (status === 'approved') {
      const built = buildPublishDecision(drafts, when, Date.now());
      if (!built.ok) return setProblem(built.reason);
      decision = built.decision as unknown as Record<string, unknown>;
    } else if (status === 'changes_requested') decision = { note: note.trim() };
    setBusy(true);
    await approvalStore.decide(a.id, status, decision);
    setBusy(false);
  }

  if (drafts.length === 0) return <p className="detail">Không có bài đăng nào trong yêu cầu này.</p>;
  return (
    <>
      <p className="lead">Xem video, sửa caption cho từng nền tảng, chọn nơi đăng và thời điểm. Chưa có gì được đăng cho tới khi bạn bấm Duyệt đăng.</p>
      {a.video && <video className="video-preview" style={{ width: '100%', maxHeight: 320 }} controls preload="metadata" src={videoFileUrl(a.video.id)} />}
      <ul className="publish-drafts">
        {drafts.map((d) => (
          <li key={d.platform}>
            <label>
              <input type="checkbox" checked={d.enabled} onChange={(e) => change(d.platform, { enabled: e.target.checked })} /> <b>{platformLabel(d.platform)}</b>
              {d.platform === 'instagram' && a.instagramAccount && <span className="hint"> · tự đăng qua API ({a.instagramAccount})</span>}
              {!viaApi(d.platform) && <span className="hint"> · đăng tay có hỗ trợ</span>}
            </label>
            <textarea className="note" rows={5} disabled={!d.enabled} value={d.caption} onChange={(e) => change(d.platform, { caption: e.target.value })} />
            <span className={`hint ${d.caption.length > CAPTION_MAX_LENGTH ? 'error' : ''}`}>
              {d.caption.length}/{CAPTION_MAX_LENGTH}
            </span>
          </li>
        ))}
      </ul>
      <fieldset className="publish-when">
        <legend>Khi nào đăng</legend>
        <label>
          <input type="radio" name={`when-${a.id}`} checked={when.mode === 'now'} onChange={() => setWhen({ mode: 'now' })} /> Đăng ngay
        </label>
        <label>
          <input type="radio" name={`when-${a.id}`} checked={when.mode === 'schedule'} onChange={() => setWhen({ mode: 'schedule', local: toDatetimeLocal(Date.now() + 3_600_000) })} /> Lên lịch
        </label>
        {when.mode === 'schedule' && <input type="datetime-local" value={when.local} onChange={(e) => setWhen({ mode: 'schedule', local: e.target.value })} />}
        {when.mode === 'schedule' && <p className="hint">Facebook: Meta giữ lịch nên máy không cần bật lúc đăng.</p>}
        {when.mode === 'schedule' && igApi && <p className="hint">Instagram: máy này tự đăng đúng giờ nên cần bật lúc đó; nếu máy tắt thì đăng ngay khi bật lại và báo trễ.</p>}
        {when.mode === 'schedule' && manual && <p className="hint">Đăng tay: chỉ nhắc bạn đến giờ, bạn tự đăng.</p>}
        {when.mode === 'now' && manual && <p className="hint">Đăng tay: bài chuyển sang "Chờ bạn đăng" trong danh sách bài đăng của chiến dịch.</p>}
      </fieldset>
      {block && (
        <p className="error" role="alert">
          {block}
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {revising && <textarea className="note" rows={3} autoFocus placeholder="Bạn muốn sửa gì? Ví dụ: ngắn hơn, thêm lời kêu gọi mua…" value={note} onChange={(e) => setNote(e.target.value)} />}
      <div className="actions">
        {revising ? (
          <>
            <button className="primary" disabled={busy || !note.trim()} onClick={() => void decide('changes_requested')}>
              Gửi yêu cầu viết lại
            </button>
            <button disabled={busy} onClick={() => setRevising(false)}>
              Huỷ
            </button>
          </>
        ) : (
          <>
            <button className="primary" disabled={busy || !!block} onClick={() => void decide('approved')}>
              ✓ Duyệt đăng
            </button>
            <button disabled={busy} onClick={() => setRevising(true)}>
              Yêu cầu viết lại caption
            </button>
            <button disabled={busy} onClick={() => void decide('rejected')}>
              Từ chối
            </button>
          </>
        )}
      </div>
    </>
  );
}

function ChooseScript({ a }: { a: ApprovalRow }) {
  const ids = ((a.subject.ids as unknown[] | undefined) ?? []).map(String);
  const byId = new Map((a.artifacts ?? []).map((x) => [x.id, x]));
  const [chosen, setChosen] = useState<string[]>([]);
  const [revising, setRevising] = useState(false);
  const [pickingTool, setPickingTool] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const videoBlock = createVideoBlockReason(a.videoAvailable);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function decide(status: 'approved' | 'changes_requested') {
    setBusy(true);
    const ok = await approvalStore.decide(a.id, status, status === 'approved' ? { chosen, ...(note.trim() && { note: note.trim() }) } : { note: note.trim() });
    setBusy(false);
    // Duyệt xong: mở chi tiết chiến dịch để thấy kết quả và việc tiếp theo.
    if (ok && a.campaignId) campaignStore.select(a.campaignId);
  }

  async function makeVideo(toolId: string) {
    setBusy(true);
    const ok = await approvalStore.decide(a.id, 'approved', { ...chooseScriptVideoDecision(chosen, toolId), ...(note.trim() && { note: note.trim() }) });
    setBusy(false);
    if (ok && a.campaignId) campaignStore.select(a.campaignId);
  }

  return (
    <>
      <p className="lead">
        Đội ngũ đã viết <b>{ids.length} kịch bản</b>. Tích chọn kịch bản bạn ưng (chọn được nhiều) để đọc đầy đủ, rồi bấm Duyệt.
      </p>
      <ol className="script-list">
        {ids.map((id, i) => {
          const art = byId.get(id);
          const picked = chosen.includes(id);
          const body = art ? artifactBody(art.content) : '';
          return (
            <li key={id} className={`script-card ${picked ? 'picked' : ''}`}>
              <label className="script-head">
                <input type="checkbox" checked={picked} onChange={() => toggle(id)} />
                <span className="script-title">{art ? artifactTitle(art.content, `Kịch bản ${i + 1}`) : `Kịch bản ${i + 1}`}</span>
              </label>
              {picked ? <Markdown text={body || 'Không có nội dung.'} /> : body && <p className="script-preview">{body.replace(/[*#]/g, '')}</p>}
            </li>
          );
        })}
      </ol>
      {revising && (
        <textarea
          className="note"
          rows={3}
          autoFocus
          placeholder="Bạn muốn sửa gì? Ví dụ: hài hơn nữa, ngắn còn 15 giây, nhắm sinh viên…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="actions">
        {revising ? (
          <>
            <button className="primary" disabled={busy || !note.trim()} onClick={() => void decide('changes_requested')}>
              Gửi yêu cầu viết lại
            </button>
            <button disabled={busy} onClick={() => setRevising(false)}>
              Huỷ
            </button>
          </>
        ) : (
          <>
            <button className="primary" disabled={busy || chosen.length === 0} onClick={() => void decide('approved')}>
              {chosen.length === 0 ? 'Chọn ít nhất 1 kịch bản' : `✓ Duyệt ${chosen.length} kịch bản`}
            </button>
            <button disabled={busy || chosen.length === 0 || !!videoBlock} title={videoBlock} onClick={() => setPickingTool((v) => !v)}>
              Tạo video
            </button>
            <button disabled={busy} onClick={() => setRevising(true)}>
              Chưa ưng — yêu cầu viết lại
            </button>
          </>
        )}
      </div>
      {videoBlock && !revising && <p className="hint">{videoBlock}</p>}
      {pickingTool && !revising && chosen.length > 0 && !videoBlock && (
        <>
          <p className="hint">Làm video ở đâu?</p>
          <VideoToolPicker disabled={busy} onPick={(id) => void makeVideo(id)} />
        </>
      )}
    </>
  );
}

function OutOfPermission({ a }: { a: ApprovalRow }) {
  const s = a.subject as { tool?: string; capability?: string; agentId?: string };
  return (
    <>
      <p className="detail">
        {s.agentId ?? 'Agent'} muốn dùng <code>{s.tool ?? s.capability ?? '?'}</code>
        {s.capability && s.tool ? <> (quyền <code>{s.capability}</code>)</> : null}
      </p>
      <div className="actions">
        <button onClick={() => void approvalStore.decide(a.id, 'approved', { grant: 'once' })}>Duyệt một lần</button>
        <button onClick={() => void approvalStore.decide(a.id, 'approved', { grant: 'permanent' })}>Duyệt vĩnh viễn</button>
        <button onClick={() => void approvalStore.decide(a.id, 'rejected')}>Từ chối</button>
      </div>
    </>
  );
}

function Generic({ a }: { a: ApprovalRow }) {
  return (
    <>
      <pre className="detail">{JSON.stringify(a.subject)}</pre>
      <div className="actions">
        <button onClick={() => void approvalStore.decide(a.id, 'approved')}>Duyệt</button>
        <button onClick={() => void approvalStore.decide(a.id, 'rejected')}>Từ chối</button>
      </div>
    </>
  );
}

export function ApprovalPanel() {
  const { approvals, errors } = useSyncExternalStore(approvalStore.subscribe, approvalStore.get, approvalStore.get);
  const { campaigns } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get, campaignStore.get);
  const campaignTitle = (id: string | null) => campaigns.find((c) => c.id === id)?.title;
  const shown = (['decide', 'approvals'] as const).flatMap((k) => (errors[k] === null ? [] : [{ k, m: errors[k] }]));
  if (approvals.length === 0 && shown.length === 0) return null;
  return (
    <section className="side-section approval-panel">
      <h2>Chờ bạn duyệt ({approvals.length})</h2>
      {shown.map(({ k, m }) => (
        <p key={k} className="error" role="alert">{m}</p>
      ))}
      {approvals.map((a) => (
        <section key={a.id}>
          <h3>
            {KIND_LABEL[a.kind] ?? a.kind}
            {campaignTitle(a.campaignId) && <span className="hint"> · {campaignTitle(a.campaignId)}</span>}
          </h3>
          {a.kind === 'choose_script' ? <ChooseScript a={a} /> : a.kind === 'make_video' ? <MakeVideo a={a} /> : a.kind === 'approve_video' ? <ApproveVideo a={a} /> : a.kind === 'approve_publish' ? <ApprovePublish a={a} /> : a.kind === 'out_of_permission' ? <OutOfPermission a={a} /> : <Generic a={a} />}
        </section>
      ))}
    </section>
  );
}
