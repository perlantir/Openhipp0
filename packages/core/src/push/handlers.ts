/**
 * Adapters that wire PushSender into existing event sources.
 *
 *   connectApprovalsToPush(governance, sender)
 *   connectCronToPush(scheduler, sender)   -- in Phase 20+ when scheduler exposes events
 *
 * Each adapter registers a listener on the event source and fans out a
 * typed PushEvent. Returning a `detach()` lets tests (and graceful shutdown)
 * unregister cleanly. Keep adapters thin — they translate, they don't
 * interpret.
 */

import type { PushEvent } from './types.js';
import type { PushSender } from './sender.js';

export interface ApprovalEmitter {
  onApprovalRequest(handler: (req: ApprovalEvent) => void): void;
}

export interface ApprovalEvent {
  id: string;
  agentId: string;
  action: string;
  description: string;
  details?: Record<string, unknown>;
}

export function connectApprovalsToPush(
  governance: ApprovalEmitter,
  sender: PushSender,
): void {
  governance.onApprovalRequest((req) => {
    const event: PushEvent = {
      kind: 'approval',
      title: `Approve: ${req.action}`,
      body: req.description,
      refId: req.id,
      categoryIdentifier: 'APPROVAL',
      urgent: true,
      data: {
        agentId: req.agentId,
        action: req.action,
        ...(req.details ?? {}),
      },
    };
    // Fire-and-forget — approval flows must not block on push delivery.
    sender.fanOut(event).catch(() => undefined);
  });
}

/** Translate a generic automation-complete callback into a PushEvent fan-out. */
export function notifyAutomationComplete(
  sender: PushSender,
  run: {
    taskId: string;
    taskName: string;
    status: 'success' | 'failure';
    summary?: string;
  },
): Promise<{ delivered: number; pruned: number; failed: number }> {
  const event: PushEvent = {
    kind: 'automation',
    title:
      run.status === 'success'
        ? `✓ ${run.taskName}`
        : `⚠ ${run.taskName} failed`,
    body: run.summary ?? (run.status === 'success' ? 'Completed.' : 'See logs for details.'),
    refId: run.taskId,
    urgent: run.status === 'failure',
    data: { status: run.status },
  };
  return sender.fanOut(event);
}

export function notifySecurityAlert(
  sender: PushSender,
  alert: { title: string; description: string; severity: 'info' | 'warn' | 'critical' },
): Promise<{ delivered: number; pruned: number; failed: number }> {
  const event: PushEvent = {
    kind: 'security',
    title: alert.title,
    body: alert.description,
    urgent: alert.severity !== 'info',
    data: { severity: alert.severity },
  };
  return sender.fanOut(event);
}
