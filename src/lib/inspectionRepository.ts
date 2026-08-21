import { serviceClient } from './supabaseClients';
import {
  isDispatchBlocked,
  resolveStatus,
  type CheckItem,
  type InspectionStatus,
  type InspectionSubmission,
  type InspectionSummary,
  type Profile,
} from './types';

/**
 * All inspection persistence. The SQL is plain Postgres; only the client
 * call style is Supabase-flavoured, so an AWS port swaps the client and
 * keeps the logic.
 */

type CheckItemRow = {
  id: string;
  code: string;
  label: string;
  help_text: string | null;
  input_type: 'boolean' | 'temperature';
  critical: boolean;
  sort_order: number;
};

const toCheckItem = (row: CheckItemRow): CheckItem => ({
  id: row.id,
  code: row.code,
  label: row.label,
  helpText: row.help_text,
  inputType: row.input_type,
  critical: row.critical,
  sortOrder: row.sort_order,
});

export const listCheckItems = async (): Promise<CheckItem[]> => {
  const { data, error } = await serviceClient()
    .from('check_items')
    .select('id, code, label, help_text, input_type, critical, sort_order')
    .eq('active', true)
    .order('sort_order');

  if (error !== null) {
    throw new Error(`Could not load the checklist: ${error.message}`);
  }
  return (data ?? []).map(toCheckItem);
};

export class ValidationError extends Error {}

/**
 * A failed check with no photo or no note is not a record, it is an
 * assertion. Rejected here as well as in the UI, because the UI is not a
 * security boundary.
 */
const assertEvidenceComplete = (submission: InspectionSubmission): void => {
  for (const answer of submission.answers) {
    if (answer.passed) {
      continue;
    }
    if (answer.note === undefined || answer.note.trim() === '') {
      throw new ValidationError(`${answer.checkItemCode} failed without a note`);
    }
    if (answer.photoKey === undefined || answer.photoKey === '') {
      throw new ValidationError(`${answer.checkItemCode} failed without a photo`);
    }
  }
};

export type SubmitResult = {
  inspectionId: string;
  status: InspectionStatus;
  dispatchBlocked: boolean;
};

export const submitInspection = async (
  submission: InspectionSubmission,
  inspector: Profile,
): Promise<SubmitResult> => {
  assertEvidenceComplete(submission);

  const checkItems = await listCheckItems();
  const itemsByCode = new Map(checkItems.map((item) => [item.code, item]));

  const missing = checkItems.filter(
    (item) => !submission.answers.some((a) => a.checkItemCode === item.code),
  );
  if (missing.length > 0) {
    throw new ValidationError(
      `Incomplete check. Missing: ${missing.map((m) => m.label).join(', ')}`,
    );
  }

  const status = resolveStatus(submission.answers, checkItems);
  const blocked = isDispatchBlocked(status);
  const db = serviceClient();

  const { data: inspection, error: inspectionError } = await db
    .from('inspections')
    .insert({
      van_id: submission.vanId,
      driver_id: submission.driverId,
      area_id: submission.areaId ?? null,
      inspector_id: inspector.id,
      status,
      dispatch_blocked: blocked,
      latitude: submission.latitude ?? null,
      longitude: submission.longitude ?? null,
      notes: submission.notes ?? null,
      supersedes_id: submission.supersedesId ?? null,
    })
    .select('id')
    .single();

  if (inspectionError !== null || inspection === null) {
    throw new Error(`Could not save the check: ${inspectionError?.message ?? 'unknown'}`);
  }

  const resultRows = submission.answers.map((answer) => {
    const item = itemsByCode.get(answer.checkItemCode);
    if (item === undefined) {
      throw new ValidationError(`Unknown check item: ${answer.checkItemCode}`);
    }
    return {
      inspection_id: inspection.id,
      check_item_id: item.id,
      passed: answer.passed,
      numeric_value: answer.numericValue ?? null,
      note: answer.note ?? null,
    };
  });

  const { data: results, error: resultsError } = await db
    .from('inspection_results')
    .insert(resultRows)
    .select('id, check_item_id');

  if (resultsError !== null || results === null) {
    // The inspection row is immutable and cannot be deleted, so an
    // orphan is surfaced loudly rather than silently swallowed.
    throw new Error(
      `Check ${inspection.id} saved but results failed: ${resultsError?.message ?? 'unknown'}`,
    );
  }

  const photoRows = submission.answers
    .filter((answer) => answer.photoKey !== undefined)
    .map((answer) => {
      const item = itemsByCode.get(answer.checkItemCode);
      const result = results.find((r) => r.check_item_id === item?.id);
      return { result_id: result?.id, storage_key: answer.photoKey };
    })
    .filter((row): row is { result_id: string; storage_key: string } =>
      row.result_id !== undefined && row.storage_key !== undefined,
    );

  if (photoRows.length > 0) {
    const { error: photoError } = await db.from('inspection_photos').insert(photoRows);
    if (photoError !== null) {
      throw new Error(`Could not attach photos: ${photoError.message}`);
    }
  }

  await db.from('audit_log').insert({
    actor_id: inspector.id,
    action: 'inspection.submitted',
    entity: 'inspections',
    entity_id: inspection.id,
    after: { status, dispatch_blocked: blocked },
  });

  return { inspectionId: inspection.id, status, dispatchBlocked: blocked };
};

type SummaryRow = {
  id: string;
  performed_at: string;
  plate: string;
  area_name: string;
  area_id: string | null;
  driver_name: string;
  inspector_name: string;
  status: InspectionStatus;
  dispatch_blocked: boolean;
  failed_count: number;
  temp_reading_c: number | null;
};

export const listInspectionsSince = async (
  since: Date,
  options: { until?: Date; areaId?: string } = {},
): Promise<InspectionSummary[]> => {
  let query = serviceClient()
    .from('v_inspection_summary')
    .select('*')
    .gte('performed_at', since.toISOString())
    .order('performed_at', { ascending: false });

  if (options.until !== undefined) {
    query = query.lte('performed_at', options.until.toISOString());
  }
  if (options.areaId !== undefined) {
    query = query.eq('area_id', options.areaId);
  }

  const { data, error } = await query;

  if (error !== null) {
    throw new Error(`Could not load the report: ${error.message}`);
  }

  return (data ?? []).map((row: SummaryRow) => ({
    id: row.id,
    performedAt: row.performed_at,
    plate: row.plate,
    areaName: row.area_name,
    driverName: row.driver_name,
    inspectorName: row.inspector_name,
    status: row.status,
    dispatchBlocked: row.dispatch_blocked,
    failedCount: row.failed_count,
    tempReadingC: row.temp_reading_c,
  }));
};
