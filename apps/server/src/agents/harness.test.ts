import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildArgs, childEnv, runClaude, type HarnessSpec } from './harness.ts';

const FAKE = fileURLToPath(new URL('../test/fake-claude.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dele-harness-'));
const spec = (over: Partial<HarnessSpec> = {}): HarnessSpec => ({
  runId: 'R1',
  token: 'tok',
  backendUrl: 'http://127.0.0.1:1',
  model: 'sonnet',
  systemPrompt: 'Bạn là An.',
  prompt: 'Làm việc',
  tools: ['WebSearch', 'WebFetch'],
  logPath: join(dir, `run-${Math.random()}.jsonl`),
  bin: FAKE,
  ...over,
});
afterEach(() => {
  delete process.env.FAKE_CLAUDE_SCENARIO;
  delete process.env.FAKE_CLAUDE_TRACE;
});

describe('buildArgs', () => {
  it('đúng cờ S5, không --bare', () => {
    const a = buildArgs(spec());
    expect(a.slice(0, 2)).toEqual(['-p', 'Làm việc']);
    for (const f of ['--output-format', 'stream-json', '--verbose', '--restricted', '--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'dontAsk'])
      expect(a).toContain(f);
    expect(a).not.toContain('--bare');
    expect(a[a.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(a.slice(a.indexOf('--allowedTools') + 1, a.indexOf('--allowedTools') + 4)).toEqual(['WebSearch', 'WebFetch', 'mcp__delebanana']);
    const mcp = JSON.parse(a[a.indexOf('--mcp-config') + 1]!);
    expect(mcp.mcpServers.delebanana.env).toEqual({ DELE_BACKEND: 'http://127.0.0.1:1', DELE_RUN_TOKEN: 'tok' });
    expect(a[a.indexOf('--system-prompt') + 1]).toBe('Bạn là An.');
  });

  it('không có công cụ → --tools rỗng', () => {
    const a = buildArgs(spec({ tools: [] }));
    expect(a[a.indexOf('--tools') + 1]).toBe('');
  });
});

describe('childEnv', () => {
  it('xoá API key (D-14) và biến của phiên Claude Code cha', () => {
    const e = childEnv({ ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'y', GEMINI_API_KEY: 'g', PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
    expect(e).toEqual({ PATH: '/bin' });
  });
});

describe('runClaude với CLI giả', () => {
  it('ok: kết quả, usage, hạn mức, log, môi trường sạch', async () => {
    const trace = join(dir, 'trace.json');
    process.env.FAKE_CLAUDE_TRACE = trace;
    process.env.ANTHROPIC_API_KEY = 'không-được-lộ';
    const seen: number[] = [];
    const s = spec();
    try {
      const r = await runClaude(s, (info) => seen.push(info.unifiedWindows!.five_hour!.utilization));
      expect(r).toMatchObject({ outcome: 'ok', exitCode: 0, text: 'xong', usage: { output_tokens: 5 }, denials: 0 });
      expect(seen).toEqual([0.4]);
      expect(readFileSync(s.logPath, 'utf8').trim().split('\n').length).toBeGreaterThanOrEqual(3);
      const t = JSON.parse(readFileSync(trace, 'utf8'));
      expect(t.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(t.cwd).not.toBe(process.cwd());
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('mức vượt có tính phí → kill, overage', async () => {
    process.env.FAKE_CLAUDE_SCENARIO = 'overage';
    expect((await runClaude(spec({ timeoutMs: 10_000 }))).outcome).toBe('overage');
  });

  it('hết hạn mức → quota_exhausted', async () => {
    process.env.FAKE_CLAUDE_SCENARIO = 'quota';
    expect((await runClaude(spec())).outcome).toBe('quota_exhausted');
  });

  it('lỗi có chữ "limit" nhưng hạn mức vẫn allowed → error, không phải quota', async () => {
    process.env.FAKE_CLAUDE_SCENARIO = 'limit_text';
    expect((await runClaude(spec())).outcome).toBe('error');
  });

  it('ký tự tiếng Việt bị cắt giữa hai đoạn dữ liệu vẫn đúng', async () => {
    process.env.FAKE_CLAUDE_SCENARIO = 'split';
    expect((await runClaude(spec())).text).toBe('xong rồi');
  });

  it('treo → timeout', async () => {
    process.env.FAKE_CLAUDE_SCENARIO = 'hang';
    expect((await runClaude(spec({ timeoutMs: 300 }))).outcome).toBe('timeout');
  });

  it('thoát lỗi → error', async () => {
    process.env.FAKE_CLAUDE_SCENARIO = 'crash';
    const r = await runClaude(spec());
    expect(r).toMatchObject({ outcome: 'error', exitCode: 2 });
    expect(r.error).toContain('lỗi giả');
  });
});
