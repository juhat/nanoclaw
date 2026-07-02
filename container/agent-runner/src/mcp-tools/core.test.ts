/**
 * Tests for the core MCP tools' interaction with the per-batch routing
 * context. The agent-runner sets a current `inReplyTo` at the top of each
 * batch in poll-loop, and outbound writes from MCP tools (send_message,
 * send_file) must pick it up so a2a return-path routing on the host can
 * correlate replies back to the originating session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { initTestSessionDb, closeSessionDb, getInboundDb } from '../db/connection.js';
import { getUndeliveredMessages } from '../db/messages-out.js';
import { setCurrentInReplyTo, clearCurrentInReplyTo, setCurrentThread, clearCurrentThread } from '../current-batch.js';
import { sendMessage } from './core.js';

function seedSessionRouting(threadId: string | null): void {
  const db = getInboundDb();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS session_routing (id INTEGER PRIMARY KEY, channel_type TEXT, platform_id TEXT, thread_id TEXT)`,
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO session_routing (id, channel_type, platform_id, thread_id) VALUES (1, 'slack', 'slack:C1', ?)`,
  ).run(threadId);
}

beforeEach(() => {
  initTestSessionDb();
  // Seed a peer agent destination
  getInboundDb()
    .prepare(
      `INSERT INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
       VALUES ('peer', 'Peer', 'agent', NULL, NULL, 'ag-peer')`,
    )
    .run();
});

afterEach(() => {
  clearCurrentInReplyTo();
  clearCurrentThread();
  closeSessionDb();
});

describe('send_message MCP tool — in_reply_to plumbing', () => {
  it('stamps current batch in_reply_to on outbound rows', async () => {
    setCurrentInReplyTo('inbound-msg-1');

    await sendMessage.handler({ to: 'peer', text: 'hello' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].in_reply_to).toBe('inbound-msg-1');
  });

  it('writes null when no batch is active', async () => {
    // No setCurrentInReplyTo before this call — simulates ad-hoc / out-of-batch invocation.
    await sendMessage.handler({ to: 'peer', text: 'hello' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].in_reply_to).toBeNull();
  });
});

describe('send_message MCP tool — proactive vs reply thread routing', () => {
  it('replies into the room when the turn was triggered by a proactive/scheduled wake (null trigger thread)', async () => {
    // Session is bound to a thread, but this turn fired from a scheduled task
    // whose trigger carries no thread → the reply must go to the channel root.
    seedSessionRouting('thread-abc');
    setCurrentThread(null);

    await sendMessage.handler({ text: 'daily report' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].thread_id).toBeNull();
  });

  it('replies into the thread when the turn was triggered by a threaded user message', async () => {
    seedSessionRouting('thread-abc');
    setCurrentThread('thread-xyz');

    await sendMessage.handler({ text: 'on it' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].thread_id).toBe('thread-xyz');
  });

  it('falls back to session routing thread when no turn is active', async () => {
    seedSessionRouting('thread-abc');
    // No setCurrentThread — defensive out-of-batch path.

    await sendMessage.handler({ text: 'hello' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].thread_id).toBe('thread-abc');
  });

  it('to_channel_root forces the room even in a threaded turn', async () => {
    seedSessionRouting('thread-abc');
    setCurrentThread('thread-xyz');

    await sendMessage.handler({ text: 'broadcast', to_channel_root: true });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].thread_id).toBeNull();
  });
});
