// Cầu nối MCP stdio ↔ HTTP của backend (TK3 mục 4). Claude Code khởi chạy tệp này; tools/list và tools/call được
// chuyển nguyên cho backend kèm token lượt chạy, backend quyết định quyền.

import { createInterface } from 'node:readline';

const { DELE_BACKEND, DELE_RUN_TOKEN } = process.env;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

async function backend(method, params) {
  const res = await fetch(`${DELE_BACKEND}/mcp/${DELE_RUN_TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  return res.json();
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // thông báo, không cần trả lời
  if (msg.method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'delebanana', version: '0.0.0' } },
    });
  }
  if (msg.method === 'tools/list' || msg.method === 'tools/call') {
    return send({ jsonrpc: '2.0', id: msg.id, result: await backend(msg.method, msg.params) });
  }
  send({ jsonrpc: '2.0', id: msg.id, result: {} });
});
