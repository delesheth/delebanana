import type { ArtifactRow } from '@delebanana/domain';
import { useState, useSyncExternalStore } from 'react';
import { campaignStore } from '../campaign/instance.ts';
import { CAMPAIGN_STATUS, chosenScripts, nextAction, researchSummary, stepsOf, type StepState } from './campaignView.ts';
import { CampaignPosts } from './CampaignPosts.tsx';
import { Markdown, artifactBody, artifactText, artifactTitle } from './markdown.tsx';
import { sidebars } from './sidebarStore.ts';

const STEP_ICON: Record<StepState, string> = { done: '✓', running: '…', waiting_you: '!', todo: '' };
const STEP_HINT: Record<StepState, string> = { done: 'Xong', running: 'Đang làm', waiting_you: 'Chờ bạn chọn', todo: 'Chưa tới' };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="small"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? '✓ Đã chép' : 'Sao chép'}
    </button>
  );
}

function Deliverable({ art, fallback }: { art: ArtifactRow; fallback: string }) {
  return (
    <article className="deliverable">
      <header>
        <h4>{artifactTitle(art.content, fallback)}</h4>
        <CopyButton text={artifactText(art.content)} />
      </header>
      <Markdown text={artifactBody(art.content)} />
    </article>
  );
}

/** Chi tiết Campaign theo ngôn ngữ người dùng: tiến độ, việc tiếp theo, kết quả (không hiện task/artifact kỹ thuật). */
export function CampaignDetail() {
  const { selectedId, detail, detailError } = useSyncExternalStore(campaignStore.subscribe, campaignStore.get);
  if (!selectedId) return null;
  if (!detail) {
    return (
      <section className="side-section">
        {detailError ? <div className="error" role="alert">{detailError}</div> : <p className="hint">Đang tải…</p>}
      </section>
    );
  }
  const { campaign } = detail;
  const steps = stepsOf(detail);
  const next = nextAction(detail);
  const scripts = chosenScripts(detail);
  const research = researchSummary(detail);
  return (
    <section className="side-section detail">
      <div className="detail-head">
        <h2>{campaign.title}</h2>
        <span className={`status-badge ${campaign.status}`}>{CAMPAIGN_STATUS[campaign.status] ?? campaign.status}</span>
      </div>
      {detailError && <div className="error" role="alert">{detailError}</div>}

      {steps.length > 0 && (
        <ol className="stepper">
          {steps.map((s) => (
            <li key={s.stage} className={s.state} title={STEP_HINT[s.state]}>
              <span className="step-dot">{STEP_ICON[s.state]}</span>
              <span className="step-label">{s.label}</span>
              <span className="step-hint">{STEP_HINT[s.state]}</span>
            </li>
          ))}
        </ol>
      )}

      <div className={`next-action ${next.kind}`}>
        <b>{next.kind === 'done' ? '🎉 Hoàn thành' : next.kind === 'approve' ? '👉 Đến lượt bạn' : next.kind === 'chat' ? '💬 Việc tiếp theo' : next.kind === 'problem' ? '⚠️ Có vấn đề' : '⏳ Đang làm'}</b>
        <p>{next.text}</p>
        {(next.kind === 'chat' || next.kind === 'done' || next.kind === 'problem') && (
          <button type="button" className="small" onClick={() => sidebars.open('right')}>
            Mở chat với Dele
          </button>
        )}
      </div>

      {scripts.length > 0 && (
        <>
          <h3>Kịch bản bạn đã chọn</h3>
          {scripts.map((a, i) => (
            <Deliverable key={a.id} art={a} fallback={`Kịch bản ${i + 1}`} />
          ))}
        </>
      )}

      <CampaignPosts campaignId={campaign.id} refreshKey={detail} />

      {research && (
        <details className="research">
          <summary>📊 Báo cáo nghiên cứu thị trường</summary>
          <Markdown text={artifactText(research.content)} />
        </details>
      )}
    </section>
  );
}
