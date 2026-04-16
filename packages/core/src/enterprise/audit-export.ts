/**
 * Audit log export — CSV / JSON / CEF (SIEM-friendly).
 *
 * Open Hipp0 already writes audit events via the governance engine + policy
 * engine. Enterprise deployments need to pipe them into Splunk / Datadog /
 * Elastic; the CEF (Common Event Format) and Syslog RFC 5424 exporters are
 * the lowest common denominator most SIEMs understand.
 */

export interface AuditEvent {
  id: string;
  timestamp: string; // ISO 8601
  actorId: string;
  actorType?: 'user' | 'agent' | 'system';
  action: string; // e.g. "tool.execute", "skill.install"
  resource?: string;
  result: 'success' | 'failure' | 'denied';
  organizationId?: string;
  projectId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export function exportAsJson(events: readonly AuditEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

export function exportAsCsv(events: readonly AuditEvent[]): string {
  const columns = [
    'id',
    'timestamp',
    'actor_id',
    'actor_type',
    'action',
    'resource',
    'result',
    'organization_id',
    'project_id',
    'ip',
    'user_agent',
    'metadata',
  ] as const;
  const header = columns.join(',');
  const rows = events.map((e) =>
    columns
      .map((c) => {
        const value = mapField(e, c);
        return escapeCsv(value);
      })
      .join(','),
  );
  return [header, ...rows].join('\n');
}

function mapField(e: AuditEvent, col: string): string {
  switch (col) {
    case 'id': return e.id;
    case 'timestamp': return e.timestamp;
    case 'actor_id': return e.actorId;
    case 'actor_type': return e.actorType ?? '';
    case 'action': return e.action;
    case 'resource': return e.resource ?? '';
    case 'result': return e.result;
    case 'organization_id': return e.organizationId ?? '';
    case 'project_id': return e.projectId ?? '';
    case 'ip': return e.ip ?? '';
    case 'user_agent': return e.userAgent ?? '';
    case 'metadata': return e.metadata ? JSON.stringify(e.metadata) : '';
  }
  return '';
}

function escapeCsv(value: string): string {
  if (/[,"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * ArcSight CEF — widely understood by SIEMs (Splunk, QRadar, Chronicle).
 * Format: `CEF:0|Vendor|Product|Version|EventId|Name|Severity|Ext`
 */
export function exportAsCef(
  events: readonly AuditEvent[],
  opts: { vendor?: string; product?: string; version?: string } = {},
): string {
  const vendor = opts.vendor ?? 'OpenHipp0';
  const product = opts.product ?? 'Hipp0';
  const version = opts.version ?? '1.0';
  return events
    .map((e) => {
      const severity = severityFromResult(e.result);
      const ext = [
        `rt=${escapeCef(e.timestamp)}`,
        `suser=${escapeCef(e.actorId)}`,
        e.organizationId ? `cs1=${escapeCef(e.organizationId)}` : '',
        e.organizationId ? `cs1Label=organization` : '',
        e.projectId ? `cs2=${escapeCef(e.projectId)}` : '',
        e.projectId ? `cs2Label=project` : '',
        e.resource ? `cs3=${escapeCef(e.resource)}` : '',
        e.resource ? `cs3Label=resource` : '',
        e.ip ? `src=${escapeCef(e.ip)}` : '',
        `outcome=${e.result}`,
      ]
        .filter(Boolean)
        .join(' ');
      return `CEF:0|${vendor}|${product}|${version}|${escapeCefHeader(e.action)}|${escapeCefHeader(e.action)}|${severity}|${ext}`;
    })
    .join('\n');
}

function escapeCefHeader(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\\/g, '\\\\');
}

function escapeCef(v: string): string {
  return v.replace(/=/g, '\\=').replace(/\\/g, '\\\\');
}

function severityFromResult(result: AuditEvent['result']): number {
  switch (result) {
    case 'success':
      return 3;
    case 'failure':
      return 6;
    case 'denied':
      return 7;
  }
}

/**
 * Streaming-friendly helper — lets callers paginate through a large audit
 * log without materializing all events at once. The source yields batches;
 * the output is a generator of formatted lines.
 */
export async function* streamExport(
  source: AsyncIterable<readonly AuditEvent[]>,
  format: 'json' | 'csv' | 'cef',
): AsyncGenerator<string> {
  let firstBatch = true;
  for await (const batch of source) {
    if (format === 'csv' && firstBatch) {
      yield exportAsCsv(batch);
    } else if (format === 'csv') {
      // Skip CSV header on subsequent batches.
      yield exportAsCsv(batch).split('\n').slice(1).join('\n');
    } else if (format === 'json') {
      yield exportAsJson(batch);
    } else {
      yield exportAsCef(batch);
    }
    firstBatch = false;
  }
}
