import { NextResponse } from 'next/server';
import { sendBlockedAlert } from '@/lib/alerts';
import {
  listCheckItems,
  listInspectionsSince,
  submitInspection,
  ValidationError,
} from '@/lib/inspectionRepository';
import { currentProfile, ForbiddenError, UnauthorizedError } from '@/lib/session';
import type { CheckAnswer, InspectionSubmission } from '@/lib/types';

/**
 * Authorization happens here, in application code, not in an RLS policy.
 * That is what makes this route survive the move to Aurora unchanged.
 */

const isCheckAnswer = (value: unknown): value is CheckAnswer => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.checkItemCode === 'string' && typeof candidate.passed === 'boolean'
  );
};

const parseSubmission = (body: unknown): InspectionSubmission => {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Expected a JSON object');
  }
  const candidate = body as Record<string, unknown>;

  if (typeof candidate.vanId !== 'string' || typeof candidate.driverId !== 'string') {
    throw new ValidationError('vanId and driverId are required');
  }
  if (!Array.isArray(candidate.answers) || !candidate.answers.every(isCheckAnswer)) {
    throw new ValidationError('answers must be a list of check results');
  }

  return {
    vanId: candidate.vanId,
    driverId: candidate.driverId,
    answers: candidate.answers,
    latitude: typeof candidate.latitude === 'number' ? candidate.latitude : undefined,
    longitude: typeof candidate.longitude === 'number' ? candidate.longitude : undefined,
    notes: typeof candidate.notes === 'string' ? candidate.notes : undefined,
    supersedesId:
      typeof candidate.supersedesId === 'string' ? candidate.supersedesId : undefined,
  };
};

const errorResponse = (cause: unknown): NextResponse => {
  if (cause instanceof UnauthorizedError) {
    return NextResponse.json({ error: cause.message }, { status: 401 });
  }
  if (cause instanceof ForbiddenError) {
    return NextResponse.json({ error: cause.message }, { status: 403 });
  }
  if (cause instanceof ValidationError) {
    return NextResponse.json({ error: cause.message }, { status: 422 });
  }
  const message = cause instanceof Error ? cause.message : 'Unexpected error';
  return NextResponse.json({ error: message }, { status: 500 });
};

export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const profile = await currentProfile();
    const submission = parseSubmission(await request.json());
    const result = await submitInspection(submission, profile);

    if (result.dispatchBlocked) {
      const checkItems = await listCheckItems();
      const labelByCode = new Map(checkItems.map((item) => [item.code, item.label]));
      const temperature = submission.answers.find((a) => a.checkItemCode === 'temp');

      // Awaited, not fired and forgotten: a held van where nobody was
      // told is the failure mode this whole feature exists to prevent.
      await sendBlockedAlert({
        inspectionId: result.inspectionId,
        plate: submission.vanId,
        driverName: submission.driverId,
        inspectorName: profile.fullName,
        failedItems: submission.answers
          .filter((a) => !a.passed)
          .map((a) => labelByCode.get(a.checkItemCode) ?? a.checkItemCode),
        temperatureC: temperature?.numericValue ?? null,
      });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (cause: unknown) {
    return errorResponse(cause);
  }
};

export const GET = async (): Promise<NextResponse> => {
  try {
    await currentProfile();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return NextResponse.json(await listInspectionsSince(startOfDay));
  } catch (cause: unknown) {
    return errorResponse(cause);
  }
};
