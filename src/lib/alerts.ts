import { serviceClient } from './supabaseClients';

/**
 * PORT BOUNDARY — notifications.
 *
 * A plain webhook POST today. On AWS this becomes an SNS publish or an
 * SES send from a Lambda; the signature stays the same.
 *
 * Every attempt is recorded in the alerts table, delivered or not. An
 * alert that silently failed is worse than no alert, because the yard
 * assumes someone was told.
 */

export type BlockedAlert = {
  inspectionId: string;
  plate: string;
  driverName: string;
  inspectorName: string;
  failedItems: string[];
  temperatureC: number | null;
};

const buildMessage = (alert: BlockedAlert): string => {
  const temp =
    alert.temperatureC === null ? '' : ` Temperature read ${alert.temperatureC.toFixed(1)} °C.`;

  return [
    `:octagonal_sign: *Dispatch held — ${alert.plate}*`,
    `Driver: ${alert.driverName}`,
    `Failed: ${alert.failedItems.join(', ')}.${temp}`,
    `Checked by ${alert.inspectorName}. The van must not leave the yard until it is re-checked.`,
  ].join('\n');
};

export const sendBlockedAlert = async (alert: BlockedAlert): Promise<void> => {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  const channel = process.env.SLACK_ALERT_CHANNEL ?? '#uae-fleet-ops';
  const db = serviceClient();

  if (webhook === undefined || webhook === '') {
    await db.from('alerts').insert({
      inspection_id: alert.inspectionId,
      channel: 'slack',
      recipient: channel,
      delivered: false,
      error: 'SLACK_WEBHOOK_URL is not configured',
      payload: alert,
    });
    return;
  }

  const text = buildMessage(alert);

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    const delivered = response.ok;
    const error = delivered ? null : `Slack returned ${response.status}`;

    await db.from('alerts').insert({
      inspection_id: alert.inspectionId,
      channel: 'slack',
      recipient: channel,
      sent_at: new Date().toISOString(),
      delivered,
      error,
      payload: { text },
    });
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Unknown network error';
    await db.from('alerts').insert({
      inspection_id: alert.inspectionId,
      channel: 'slack',
      recipient: channel,
      delivered: false,
      error: message,
      payload: { text },
    });
  }
};
