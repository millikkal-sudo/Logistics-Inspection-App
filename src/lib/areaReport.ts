import { serviceClient } from './supabaseClients';
import { getReportStats, listInspectionsSince } from './inspectionRepository';
import type { InspectionSummary, Profile } from './types';

/**
 * The end-of-round report a supervisor sends to Slack.
 *
 * One builder, three shapes, chosen by what actually happened rather
 * than by the sender. A clean round gets four lines. A round with one
 * failure collapses the breakdown, because "vans held", "main gaps" and
 * "deviations by driver" would each repeat the same fact. Three or more
 * failures and the sections start earning their space.
 */

const BUCKET = 'inspection-photos';
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Slack caps a message at 50 blocks. Leave room for the summary. */
const MAX_IMAGE_BLOCKS_PER_MESSAGE = 40;

/** Below this, the breakdown sections say the same thing three times. */
const FAILURE_DETAIL_THRESHOLD = 3;

/** Every van runs 0 to 5 degrees. */
const TEMP_MAX_C = 5;

export type AreaReportInput = {
  areaId: string;
  areaName: string;
  note?: string;
  /** Origin of the deployment, so the report can link back to the record. */
  origin?: string;
};

type Evidence = {
  plate: string;
  driverName: string;
  checkLabel: string;
  note: string | null;
  url: string;
};

type Deviation = { name: string; count: number; items: string[] };

type SlackBlock =
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' }
  | { type: 'context'; elements: { type: 'mrkdwn'; text: string }[] }
  | { type: 'image'; image_url: string; alt_text: string };

const section = (text: string): SlackBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

type FailureRow = {
  inspection_id: string;
  note: string | null;
  check_items: { label: string } | { label: string }[] | null;
  inspection_photos: { storage_key: string }[] | null;
};

const labelOf = (relation: FailureRow['check_items']): string => {
  if (relation === null) {
    return 'Unknown';
  }
  return Array.isArray(relation) ? (relation[0]?.label ?? 'Unknown') : relation.label;
};

const gather = async (
  records: InspectionSummary[],
): Promise<{
  byCheck: Map<string, number>;
  byDriver: Map<string, Deviation>;
  evidence: Evidence[];
  failureCount: number;
}> => {
  const byCheck = new Map<string, number>();
  const byDriver = new Map<string, Deviation>();
  const evidence: Evidence[] = [];

  const ids = records.filter((record) => record.failedCount > 0).map((record) => record.id);
  if (ids.length === 0) {
    return { byCheck, byDriver, evidence, failureCount: 0 };
  }

  const db = serviceClient();
  const { data } = await db
    .from('inspection_results')
    .select('inspection_id, note, check_items(label), inspection_photos(storage_key)')
    .in('inspection_id', ids)
    .eq('passed', false);

  const rows = (data ?? []) as unknown as FailureRow[];

  for (const raw of rows) {
    const label = labelOf(raw.check_items);
    byCheck.set(label, (byCheck.get(label) ?? 0) + 1);

    const record = records.find((candidate) => candidate.id === raw.inspection_id);
    if (record === undefined) {
      continue;
    }

    const existing = byDriver.get(record.driverName) ?? {
      name: record.driverName,
      count: 0,
      items: [],
    };
    existing.count += 1;
    existing.items.push(label);
    byDriver.set(record.driverName, existing);

    for (const photo of raw.inspection_photos ?? []) {
      const { data: signed } = await db.storage
        .from(BUCKET)
        .createSignedUrl(photo.storage_key, SIGNED_URL_TTL_SECONDS);

      if (signed !== null) {
        evidence.push({
          plate: record.plate,
          driverName: record.driverName,
          checkLabel: label,
          note: raw.note,
          url: signed.signedUrl,
        });
      }
    }
  }

  return { byCheck, byDriver, evidence, failureCount: rows.length };
};

/**
 * The most recent earlier day this area was inspected, not simply
 * yesterday. On a fleet that does not run every day, "yesterday" is
 * often zero and the comparison becomes noise.
 */
const previousRound = async (
  areaId: string,
  before: Date,
): Promise<{ label: string; compliancePct: number } | null> => {
  const start = new Date(before);
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);

  const earlier = await listInspectionsSince(start, { until: new Date(before.getTime() - 1), areaId });
  if (earlier.length === 0) {
    return null;
  }

  const days = new Map<string, InspectionSummary[]>();
  for (const record of earlier) {
    const key = record.performedAt.slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), record]);
  }

  const latestKey = [...days.keys()].sort().pop();
  if (latestKey === undefined) {
    return null;
  }

  const dayRecords = days.get(latestKey) ?? [];
  const cleared = dayRecords.filter((record) => record.status === 'compliant').length;

  const date = new Date(`${latestKey}T12:00:00`);
  const isYesterday =
    new Date(before).setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0) === 86_400_000;

  return {
    label: isYesterday
      ? 'yesterday'
      : new Date(`${latestKey}T12:00:00`).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        }),
    compliancePct: dayRecords.length === 0 ? 0 : Math.round((cleared / dayRecords.length) * 100),
  };
};

export type BuiltReport = {
  text: string;
  messages: { text: string; blocks: SlackBlock[] }[];
  photoCount: number;
};

export const buildAreaReport = async (
  input: AreaReportInput,
  inspector: Profile,
): Promise<BuiltReport> => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const now = new Date();

  const [records, stats] = await Promise.all([
    listInspectionsSince(startOfDay, { areaId: input.areaId }),
    getReportStats(startOfDay, now, input.areaId),
  ]);

  const noteLine =
    input.note === undefined || input.note.trim() === ''
      ? null
      : `*Inspector's notes:* ${input.note.trim()}`;

  const dateLabel = now.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (records.length === 0) {
    const lines = [
      `*${input.areaName}, morning pre-departure*`,
      `${dateLabel} · ${inspector.fullName}`,
      '',
      `:warning: *No vans inspected.* ${plural(stats.vansActive, 'van')} in this area were not checked.`,
    ];
    if (noteLine !== null) {
      lines.push('', noteLine);
    }
    const text = lines.join('\n');
    return { text, messages: [{ text, blocks: [section(text)] }], photoCount: 0 };
  }

  const { byCheck, byDriver, evidence, failureCount } = await gather(records);

  const cleared = records.filter((record) => record.status === 'compliant').length;
  const held = records.filter((record) => record.dispatchBlocked).length;
  const nonCompliant = records.filter((record) => record.status === 'noncompliant').length;

  const times = records.map((record) => record.performedAt).sort();
  const window =
    times.length > 1 && times[0] !== undefined && times[times.length - 1] !== undefined
      ? `${timeOf(times[0])} to ${timeOf(times[times.length - 1] ?? times[0])}`
      : timeOf(times[0] ?? now.toISOString());

  const previous = await previousRound(input.areaId, startOfDay);
  const trend =
    previous === null
      ? ''
      : (() => {
          const delta = stats.compliancePct - previous.compliancePct;
          if (delta === 0) {
            return `, level with ${previous.label}`;
          }
          return `, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} points on ${previous.label}`;
        })();

  const temps = records
    .map((record) => record.tempReadingC)
    .filter((value): value is number => value !== null);
  const worstTemp = temps.length === 0 ? null : Math.max(...temps);

  // A bare figure invites five readings. Say what it means.
  const tempVerdict =
    worstTemp === null
      ? null
      : worstTemp > TEMP_MAX_C
        ? `*Highest temperature: ${worstTemp.toFixed(1)} °C*, above the ${TEMP_MAX_C} °C limit`
        : worstTemp === TEMP_MAX_C
          ? `*Highest temperature: ${worstTemp.toFixed(1)} °C*, within range but at the limit`
          : `*Highest temperature: ${worstTemp.toFixed(1)} °C*, within range`;

  const heldRecords = records.filter((record) => record.dispatchBlocked);

  const icon = held > 0 ? ':octagonal_sign:' : failureCount > 0 ? ':warning:' : ':white_check_mark:';

  const lines: string[] = [
    `${icon} *${input.areaName}, morning pre-departure*`,
    `${dateLabel}, ${window} · ${inspector.fullName}`,
    '',
  ];

  // Coverage first. "5 checked" says nothing without the denominator, and
  // an uninspected van is a larger unknown than a failed one.
  if (stats.missedPlates.length === 0) {
    lines.push(
      `*Coverage: ${stats.vansCovered} of ${stats.vansActive} vans.* Full fleet inspected${
        failureCount === 0 ? ', all cleared first time.' : '.'
      }`,
    );
  } else {
    lines.push(
      `*Coverage: ${stats.vansCovered} of ${stats.vansActive} vans.* ${stats.missedPlates.length} not inspected: ${stats.missedPlates.join(', ')}`,
    );
  }

  // A clean round needs no compliance line: coverage already said it.
  if (failureCount > 0) {
    const parts = [`${cleared} cleared`];
    if (nonCompliant > 0) {
      parts.push(`${nonCompliant} non-compliant`);
    }
    if (held > 0) {
      parts.push(`${held} held`);
    }
    lines.push(`*Compliance: ${stats.compliancePct}%* (${parts.join(', ')})${trend}`);
  }

  if (tempVerdict !== null) {
    lines.push(tempVerdict);
  }

  if (failureCount > 0 && failureCount < FAILURE_DETAIL_THRESHOLD) {
    // Collapsed: one line per problem rather than three headings that
    // each restate it.
    lines.push('');
    for (const record of records.filter((candidate) => candidate.failedCount > 0)) {
      const deviation = byDriver.get(record.driverName);
      const checks = deviation === undefined ? '' : [...new Set(deviation.items)].join(', ');
      lines.push(
        record.dispatchBlocked
          ? `*${record.plate} held.* ${checks}, ${record.driverName}. Must not dispatch until re-checked.`
          : `*${record.plate}.* ${checks}, ${record.driverName}.`,
      );
    }
  } else if (failureCount >= FAILURE_DETAIL_THRESHOLD) {
    if (heldRecords.length > 0) {
      lines.push(
        '',
        '*Vans held*',
        ...heldRecords.map((record) => `• ${record.plate}, ${record.driverName}`),
      );
    }

    const topChecks = [...byCheck.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `• ${label}, ${plural(count, 'van')}`);
    if (topChecks.length > 0) {
      lines.push('', '*Main gaps*', ...topChecks);
    }

    const deviations = [...byDriver.values()]
      .sort((a, b) => b.count - a.count)
      .map((entry) => `• ${entry.name}, ${entry.count} (${[...new Set(entry.items)].join(', ')})`);
    if (deviations.length > 0) {
      lines.push('', '*Deviations by driver*', ...deviations);
    }
  }

  // Always included when written, whichever shape the report takes.
  if (noteLine !== null) {
    lines.push('', noteLine);
  }

  if (input.origin !== undefined && input.origin !== '') {
    lines.push('', `<${input.origin}/admin|View the full record and photos>`);
  }

  const summary = lines.join('\n');

  const imageBlocks: SlackBlock[] = evidence.flatMap((item) => [
    {
      type: 'context' as const,
      elements: [
        {
          type: 'mrkdwn' as const,
          text: `*${item.plate}* · ${item.checkLabel} · ${item.driverName}${
            item.note === null || item.note === '' ? '' : ` · ${item.note}`
          }`,
        },
      ],
    },
    { type: 'image' as const, image_url: item.url, alt_text: `${item.plate} ${item.checkLabel}` },
  ]);

  const messages: BuiltReport['messages'] = [];

  if (imageBlocks.length === 0) {
    messages.push({ text: summary, blocks: [section(summary)] });
  } else {
    const chunks: SlackBlock[][] = [];
    for (let i = 0; i < imageBlocks.length; i += MAX_IMAGE_BLOCKS_PER_MESSAGE) {
      chunks.push(imageBlocks.slice(i, i + MAX_IMAGE_BLOCKS_PER_MESSAGE));
    }

    chunks.forEach((chunk, index) => {
      if (index === 0) {
        messages.push({
          text: summary,
          blocks: [
            section(summary),
            { type: 'divider' },
            section(`*Evidence* (${plural(evidence.length, 'photo')})`),
            ...chunk,
          ],
        });
      } else {
        messages.push({
          text: `${input.areaName}, evidence continued`,
          blocks: [section(`*Evidence continued (${index + 1} of ${chunks.length})*`), ...chunk],
        });
      }
    });
  }

  return { text: summary, messages, photoCount: evidence.length };
};

export const postAreaReport = async (report: BuiltReport, areaId: string): Promise<void> => {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  const channel = process.env.SLACK_ALERT_CHANNEL ?? '#uae-fleet-ops';
  const db = serviceClient();

  const log = async (delivered: boolean, error: string | null): Promise<void> => {
    await db.from('alerts').insert({
      inspection_id: null,
      channel: 'slack',
      recipient: channel,
      sent_at: new Date().toISOString(),
      delivered,
      error,
      payload: { text: report.text, area_id: areaId, photos: report.photoCount },
    });
  };

  if (webhook === undefined || webhook === '') {
    await log(false, 'SLACK_WEBHOOK_URL is not configured');
    throw new Error('Slack is not set up yet. Ask Aflah to add the webhook URL.');
  }

  try {
    for (const message of report.messages) {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const detail = await response.text();
        await log(false, `Slack returned ${response.status}: ${detail.slice(0, 200)}`);
        throw new Error(`Slack rejected the report (${response.status})`);
      }
    }
    await log(true, null);
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Network error';
    if (!message.startsWith('Slack rejected')) {
      await log(false, message);
    }
    throw new Error(message);
  }
};
