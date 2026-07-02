/**
 * Per-batch context the poll loop publishes for downstream consumers
 * (MCP tools, etc.) that don't sit on the poll-loop's call stack.
 *
 * Today the only field is `inReplyTo` — the id of the first inbound
 * message in the batch the agent is currently processing. MCP tools like
 * `send_message` and `send_file` read this and stamp it onto the outbound
 * row so the host's a2a return-path routing can correlate replies back to
 * the originating session.
 *
 * This is module-level state on purpose: the agent-runner is single-process
 * and processes one batch at a time. Poll-loop calls `setCurrentInReplyTo`
 * before invoking the provider and `clearCurrentInReplyTo` after the batch
 * completes (or errors out).
 */
let currentInReplyTo: string | null = null;

export function setCurrentInReplyTo(id: string | null): void {
  currentInReplyTo = id;
}

export function clearCurrentInReplyTo(): void {
  currentInReplyTo = null;
}

export function getCurrentInReplyTo(): string | null {
  return currentInReplyTo;
}

/**
 * The thread the batch currently being processed was triggered from.
 *
 * `set` is false when no batch is active (defensive — MCP tools always run
 * inside a batch today). When a batch is active, `threadId` is the trigger's
 * thread — null for a proactive/scheduled wake (which should post to the
 * channel root), or the thread id for a reply to a threaded user message.
 *
 * MCP tools prefer this over the session's static routing so a scheduled task
 * posts to the room while a reply to a threaded message stays in that thread.
 */
let currentThreadId: string | null = null;
let currentThreadSet = false;

export function setCurrentThread(threadId: string | null): void {
  currentThreadId = threadId;
  currentThreadSet = true;
}

export function clearCurrentThread(): void {
  currentThreadId = null;
  currentThreadSet = false;
}

export function getCurrentThread(): { set: boolean; threadId: string | null } {
  return { set: currentThreadSet, threadId: currentThreadId };
}

