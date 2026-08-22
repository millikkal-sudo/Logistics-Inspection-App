import { NextResponse } from 'next/server';
import {
  importStaff,
  importVans,
  previewStaff,
  previewVans,
  type StaffDraft,
  type VanDraft,
} from '@/lib/bulkImport';
import { ValidationError } from '@/lib/inspectionRepository';
import { currentProfile, ForbiddenError, requireRole, UnauthorizedError } from '@/lib/session';

/**
 * Bulk import. Always previewed first: the client calls with commit=false
 * to see what would happen, then commit=true to write it.
 *
 * The preview is recomputed on commit rather than trusting what the
 * client sends back, so a van added by someone else in between still
 * gets caught as a duplicate.
 */
export const POST = async (request: Request): Promise<NextResponse> => {
  try {
    const profile = await currentProfile();
    requireRole(profile, ['manager', 'admin']);

    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null) {
      throw new ValidationError('Expected a JSON object');
    }

    const payload = body as Record<string, unknown>;
    const entity = payload.entity;
    const text = payload.text;
    const commit = payload.commit === true;

    if (entity !== 'vans' && entity !== 'drivers') {
      throw new ValidationError('entity must be vans or drivers');
    }
    if (typeof text !== 'string' || text.trim() === '') {
      throw new ValidationError('Nothing to import');
    }

    if (entity === 'vans') {
      const preview = await previewVans(text);
      if (!commit) {
        return NextResponse.json(preview);
      }
      const imported = await importVans(preview.valid as VanDraft[], profile);
      return NextResponse.json({ ...preview, imported });
    }

    const preview = await previewStaff(text);
    if (!commit) {
      return NextResponse.json(preview);
    }
    const imported = await importStaff(preview.valid as StaffDraft[], profile);
    return NextResponse.json({ ...preview, imported });
  } catch (cause: unknown) {
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
  }
};
