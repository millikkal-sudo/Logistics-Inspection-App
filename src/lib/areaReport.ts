import { serviceClient } from './supabaseClients';
import { listInspectionsSince } from './inspectionRepository';
import type { InspectionSummary, Profile } from './types';

/**
 * The end-of-round report a supervisor sends to Slack after working an
 * area. Replaces the per-van alert: the inspector is standing at the van
 * and holds it themselves, so the channel wants the round, not a
 * running commentary.
 *
 * Every photo the inspector attached is posted inline. Slack fetches
 * each signed URL when the message lands and caches the image on its
 * own servers, so the pictures survive the link expiring.
 */

const BUCKET = 'inspection-photos';
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Slack caps a message at 50 blocks. Leave room for the summary. */
const MAX_IMAGE_BLOCKS_PER_MESSAGE = 40;

export type AreaReportInput = {
  areaId: string;
  areaName: string;
  note?: string;
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
  | { type: 'image'; image_url: string; alt_text: string; title?: { type: 'plain_text'; text: string } };

const percentage = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

const pluralVans = (count: number): string => `${count} van${count === 1 ? '' : 's'}`;

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

/**
 * Which checks failed, who they failed on, and the evidence attached.
 * All three come from one pass: the check tells you what to fix
 * systemically, the name tells you who to talk to, the photo settles it.
 */
const gather = async (
  records: InspectionSummary[],
): Promise<{
  byCheck: Map<string, number>;
  byDriver: Map<string, Deviation>;
  evidence: Evidence[];
}> => {
  const byCheck = new Map<string, number>();
  const byDriver = new Map<string, Deviation>();
  const evidence: Evidence[] = [];

  const ids = records.filter((record) => record.failedCount > 0).map((record) => record.id);
  if (ids.length === 0) {
    return { byCheck, byDriver, evidence };
  }

  const db = serviceClient();

  const { data } = await db
    .from('inspection_results')
    .select('inspection_id, note, check_items(label), inspection_photos(storage_key)')
    .in('inspection_id', ids)
    .eq('passed', false);

  for (const raw of (data ?? []) as unknown as FailureRow[]) {
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

  return { byCheck, byDriver, evidence };
};

export type BuiltReport = {
  /** Plain-text fallback, and what the preview shows. */
  text: string;
  /** One entry per Slack message. Long rounds are split. */
  messages: { text: string; blocks: SlackBlock[] }[];
  photoCount: number;
};

export const buildAreaReport = async (
  input: AreaReportInput,
  inspector: Profile,
): Promise<BuiltReport> => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const records = await listInspectionsSince(startOfDay, { areaId: input.areaId });
  const total = records.length;

  if (total === 0) {
    const empty = `*${input.areaName} — no checks recorded today.*`;
    return {
      text: empty,
      messages: [{ text: empty, blocks: [section(empty)] }],
      photoCount: 0,
    };
  }

  const cleared = records.filter((record) => record.status === 'compliant').length;
  const held = records.filter((record) => record.dispatchBlocked).length;
  const nonCompliant = records.filter((record) => record.status === 'noncompliant').length;
  const compliance = percentage(cleared, total);

  const { byCheck, byDriver, evidence } = await gather(records);

  const topChecks = [...byCheck.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `  • ${label} — ${pluralVans(count)}`);

  const deviations = [...byDriver.values()]
    .sort((a, b) => b.count - a.count)
    .map((entry) => `  • ${entry.name} — ${entry.count} (${[...new Set(entry.items)].join(', ')})`);

  const heldVans = records
    .filter((record) => record.dispatchBlocked)
    .map((record) => `  • ${record.plate} — ${record.driverName}`);

  const temps = records
    .map((record) => record.tempReadingC)
    .filter((value): value is number => value !== null);
  const worstTemp = temps.length === 0 ? null : Math.max(...temps);

  // A compliance figure with no verdict invites everyone to read it
  // differently. State the call plainly, above the numbers.
  const verdict =
    compliance === 100
      ? ':white_check_mark: Whole area cleared first time.'
      : held > 0
        ? `:octagonal_sign: ${pluralVans(held)} held and must not dispatch until re-checked.`
        : ':warning: No vans held, but the failures below need closing today.';

  const lines: string[] = [
    `*${input.areaName} — morning pre-departure report*`,
    `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · inspected by ${inspector.fullName}`,
    '',
    verdict,
    '',
    `*Compliance:* ${compliance}%  (${cleared} cleared / ${nonCompliant} non-compliant / ${held} held of ${total} checked)`,
  ];

  if (worstTemp !== null) {
    lines.push(`*Highest temperature recorded:* ${worstTemp.toFixed(1)} °C`);
  }
  if (heldVans.length > 0) {
    lines.push('', '*Vans held:*', ...heldVans);
  }
  if (topChecks.length > 0) {
    lines.push('', '*Main gaps:*', ...topChecks);
  }
  if (deviations.length > 0) {
    lines.push('', '*Deviations by driver:*', ...deviations);
  }
  if (input.note !== undefined && input.note.trim() !== '') {
    lines.push('', `*Inspector's notes:* ${input.note.trim()}`);
  }

  const summary = lines.join('\n');

  const imageBlocks: SlackBlock[] = evidence.flatMap((item) => [
    {
      type: 'context' as const,
      elements: [
        {
          type: 'mrkdwn' as const,
          text: `*${item.plate}* · ${item.checkLabel} · ${item.driverName}${
            item.note === null || item.note === '' ? '' : ` — ${item.note}`
          }`,
        },
      ],
    },
    {
      type: 'image' as const,
      image_url: item.url,
      alt_text: `${item.plate} ${item.checkLabel}`,
    },
  ]);

  // Slack rejects a message over 50 blocks, so a long round is split
  // across several rather than silently dropping the tail.
  const messages: BuiltReport['messages'] = [];
  const header: SlackBlock[] = [section(summary)];

  if (imageBlocks.length === 0) {
    messages.push({ text: summary, blocks: header });
  } else {
    const chunks: SlackBlock[][] = [];
    for (let i = 0; i < imageBlocks.length; i += MAX_IMAGE_BLOCKS_PER_MESSAGE) {
      chunks.push(imageBlocks.slice(i, i + MAX_IMAGE_BLOCKS_PER_MESSAGE));
    }

    chunks.forEach((chunk, index) => {
      if (index === 0) {
        messages.push({
          text: summary,
          blocks: [...header, { type: 'divider' }, section('*Evidence*'), ...chunk],
        });
      } else {
        messages.push({
          text: `${input.areaName} — evidence continued`,
          blocks: [section(`*Evidence continued (${index + 1} of ${chunks.length})*`), ...chunk],
        });
      }
    });
  }

  return { text: summary, messages, photoCount: evidence.length };
};

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

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
