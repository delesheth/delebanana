// CLI Harness (D-7, TK3 mục 3): chạy một lượt Claude Code headless đúng ranh giới đã kiểm ở S5 và đọc stream JSON.
// Chặn chi phí (D-14): không --bare, xoá mọi API key khỏi môi trường con, dừng ngay khi CLI báo dùng mức vượt.

import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RateLimitInfo } from './usage.ts';

export interface HarnessSpec {
  runId: string;
  token: string;
  backendUrl: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  /** Công cụ có sẵn của CLI được bật (vd. WebSearch, WebFetch); rỗng = tắt hết. */
  tools: string[];
  /** Tệp chép vào thư mục làm việc của lượt chạy (vd. ảnh sản phẩm để CLI đọc bằng Read); `name` là đường dẫn tương đối. */
  files?: { from: string; name: string }[];
  logPath: string;
  timeoutMs?: number;
  bin?: string;
}

export type RunOutcome = 'ok' | 'error' | 'timeout' | 'quota_exhausted' | 'overage';

export interface HarnessResult {
  outcome: RunOutcome;
  exitCode: number | null;
  text?: string;
  usage?: Record<string, number>;
  durationMs: number;
  denials: number;
  rateLimits: RateLimitInfo[];
  error?: string;
}

export type Harness = (spec: HarnessSpec, onRateLimit?: (info: RateLimitInfo) => void) => Promise<HarnessResult>;

const BRIDGE = fileURLToPath(new URL('./mcp-bridge.mjs', import.meta.url));
const TIMEOUT_MS = 300_000;
const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];
const OK_STATUS = new Set(['allowed', 'allowed_warning']);

export function buildArgs(spec: HarnessSpec): string[] {
  const mcp = { mcpServers: { delebanana: { command: process.execPath, args: [BRIDGE], env: { DELE_BACKEND: spec.backendUrl, DELE_RUN_TOKEN: spec.token } } } };
  return [
    '-p', spec.prompt,
    '--output-format', 'stream-json', '--verbose',
    '--restricted',
    '--tools', spec.tools.join(','),
    '--allowedTools', ...spec.tools, 'mcp__delebanana',
    '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp),
    '--no-session-persistence', '--permission-mode', 'dontAsk',
    '--model', spec.model,
    '--system-prompt', spec.systemPrompt,
  ];
}

export function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const k of STRIPPED_ENV) delete env[k];
  return env;
}

export const runClaude: Harness = (spec, onRateLimit) =>
  new Promise((resolve) => {
    const started = Date.now();
    const cwd = mkdtempSync(join(tmpdir(), 'dele-run-'));
    for (const f of spec.files ?? []) {
      const to = join(cwd, f.name);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(f.from, to);
    }
    mkdirSync(dirname(spec.logPath), { recursive: true });
    const result: HarnessResult = { outcome: 'ok', exitCode: null, durationMs: 0, denials: 0, rateLimits: [] };
    let forced: RunOutcome | undefined;
    let resultError = false;
    let stderr = '';
    const child = spawn(spec.bin ?? process.env.DELE_CLAUDE_BIN ?? 'claude', buildArgs(spec), { cwd, env: childEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (why: RunOutcome) => {
      forced ??= why;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => kill('timeout'), spec.timeoutMs ?? TIMEOUT_MS);

    let buf = '';
    const onLine = (line: string) => {
      if (!line.trim()) return;
      appendFileSync(spec.logPath, line + '\n');
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === 'rate_limit_event') {
        const info = ev.rate_limit_info as RateLimitInfo;
        result.rateLimits.push(info);
        // Chặn chi phí trước, rồi mới ghi nhận (lỗi khi ghi không được cản việc dừng tiến trình).
        if (info.isUsingOverage) kill('overage');
        // Chỉ coi là hết hạn mức khi CLI báo trạng thái hạn mức không còn cho phép — không đoán từ chữ "limit".
        else if (info.status && !OK_STATUS.has(info.status)) forced ??= 'quota_exhausted';
        try {
          onRateLimit?.(info);
        } catch (err) {
          console.error('Ghi hạn mức lỗi:', err);
        }
      } else if (ev.type === 'result') {
        result.text = ev.result;
        result.usage = ev.usage;
        result.denials = ev.permission_denials?.length ?? 0;
        resultError = !!ev.is_error;
      }
    };
    // Giải mã UTF-8 theo luồng: ký tự tiếng Việt nhiều byte có thể bị cắt giữa hai đoạn dữ liệu.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf) onLine(buf); // dòng cuối không có ký tự xuống dòng
      rmSync(cwd, { recursive: true, force: true });
      result.exitCode = code;
      result.durationMs = Date.now() - started;
      result.outcome = forced ?? (code !== 0 || resultError ? 'error' : 'ok');
      if (stderr.trim()) result.error = stderr.trim().slice(0, 500);
      resolve(result);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      result.outcome = 'error';
      result.error = err.message;
    });
  });
