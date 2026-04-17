import { useState, type ReactElement } from 'react';

import type { StreamEvent } from '../api/streaming.js';

export interface ToolCallPreviewProps {
  readonly event: StreamEvent;
  readonly onApprove: (typedConfirmation?: string) => void;
  readonly onReject: (reason?: string) => void;
  readonly onEdit?: (args: Record<string, unknown>) => void;
}

export function ToolCallPreview({ event, onApprove, onReject, onEdit }: ToolCallPreviewProps): ReactElement {
  const [confirmation, setConfirmation] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const needsTyped = event.previewStrategy === 'preview-approval-typed';

  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      role="dialog"
      aria-label={`tool call preview for ${event.toolName ?? 'unknown'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono font-semibold">{event.toolName}</span>
        <span className="rounded bg-amber-200 px-2 py-0.5 text-xs">awaiting approval</span>
      </div>
      {event.summary && <p className="mb-2">{event.summary}</p>}
      <pre className="mb-3 overflow-x-auto rounded bg-white p-2 text-xs text-slate-800">
        {JSON.stringify(event.args ?? {}, null, 2)}
      </pre>
      {needsTyped && (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium">
            Type <code className="font-mono">CONFIRM</code> to proceed:
          </label>
          <input
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="w-full rounded border border-amber-300 bg-white px-2 py-1 font-mono text-sm"
            data-testid="typed-confirm"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={needsTyped && confirmation !== 'CONFIRM'}
          onClick={() => onApprove(needsTyped ? confirmation : undefined)}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onReject(rejectReason || undefined)}
          className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700"
        >
          Reject
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(event.args ?? {})}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Edit args…
          </button>
        )}
        <input
          type="text"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="optional reason"
          className="ml-auto w-48 rounded border border-amber-300 bg-white px-2 py-1 text-xs"
          data-testid="reject-reason"
        />
      </div>
    </div>
  );
}
