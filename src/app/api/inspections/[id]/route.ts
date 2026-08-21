import { NextResponse } from 'next/server';
import { getInspectionDetail } from '@/lib/inspectionRepository';
import { currentProfile, ForbiddenError, requireRole, UnauthorizedError } from '@/lib/session';

export const GET = async (
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  try {
    const profile = await currentProfile();
    requireRole(profile, ['manager', 'admin']);

    const { id } = await context.params;
    const detail = await getInspectionDetail(id);

    if (detail === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (cause: unknown) {
    if (cause instanceof UnauthorizedError) {
      return NextResponse.json({ error: cause.message }, { status: 401 });
    }
    if (cause instanceof ForbiddenError) {
      return NextResponse.json({ error: cause.message }, { status: 403 });
    }
    const message = cause instanceof Error ? cause.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
