#!/usr/bin/env node
// CLI giả thay Claude Code trong kiểm thử: không gọi mạng, không tốn hạn mức. Ghi argv + env vào FAKE_CLAUDE_TRACE,
// rồi in stream JSON theo FAKE_CLAUDE_SCENARIO: ok | overage | quota | hang | crash.
import { writeFileSync } from 'node:fs';

const { FAKE_CLAUDE_TRACE, FAKE_CLAUDE_SCENARIO = 'ok' } = process.env;
if (FAKE_CLAUDE_TRACE) writeFileSync(FAKE_CLAUDE_TRACE, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() }));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const rate = (extra = {}) =>
  out({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', resetsAt: 1800003600, isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1800003600 }, seven_day: { utilization: 0.1, resetsAt: 1800100000 } }, ...extra },
  });

out({ type: 'system', subtype: 'init', apiKeySource: 'none', tools: [] });
switch (FAKE_CLAUDE_SCENARIO) {
  case 'ok':
    rate();
    out({ type: 'result', subtype: 'success', is_error: false, result: 'xong', duration_ms: 12, num_turns: 1, usage: { input_tokens: 3, output_tokens: 5 }, permission_denials: [] });
    break;
  case 'overage':
    rate({ isUsingOverage: true });
    setInterval(() => {}, 1000); // treo: harness phải kill
    break;
  case 'quota':
    rate({ status: 'rejected' });
    out({ type: 'result', subtype: 'error', is_error: true, result: 'Usage limit reached', usage: {}, permission_denials: [] });
    process.exit(1);
    break;
  case 'limit_text':
    // Lỗi có chữ "limit" nhưng không phải hết hạn mức (vd. giới hạn ngữ cảnh).
    rate();
    out({ type: 'result', subtype: 'error', is_error: true, result: 'Context limit reached', usage: {}, permission_denials: [] });
    process.exit(1);
    break;
  case 'split': {
    // Cắt giữa một ký tự tiếng Việt nhiều byte để kiểm giải mã UTF-8 theo luồng.
    const line = Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'xong rồi', usage: {}, permission_denials: [] }) + '\n');
    const cut = line.indexOf(Buffer.from('ồ')) + 1;
    process.stdout.write(line.subarray(0, cut));
    setTimeout(() => process.stdout.write(line.subarray(cut)), 30);
    break;
  }
  case 'hang':
    setInterval(() => {}, 1000);
    break;
  case 'crash':
    process.stderr.write('lỗi giả\n');
    process.exit(2);
}
