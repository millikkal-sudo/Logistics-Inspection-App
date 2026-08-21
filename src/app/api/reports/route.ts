import { NextResponse } from 'next/server';
import { listInspectionsSince } from '@/lib/inspectionRepository';
import { currentProfile, ForbiddenError, requireRole, UnauthorizedError } from '@/lib/session';

/**
 * Report data for the manager dashboard, as JSON or CSV.
 *
 * The CSV is the audit pack: one row per inspection, ready to hand to a
 * Municipality inspector or attach to an internal HACCP review.
 */

const csvCell = (value: string | number | null): string => {
  if (value === null) {
    return '';
  }
  const text = String(value);
  // Guard against a leading =, +, - or @ being executed as a formula
  // when the file is opened in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const profile = await currentProfile();
    requireRole(profile, ['manager', 'admin']);

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const areaId = searchParams.get('areaId');
    const format = searchParams.get('format');

    const from = fromParam === null ? new Date(Date.now() - 30 * 86_400_000) : new Date(fromParam);
    const to = toParam === null ? new Date() : new Date(`${toParam}T23:59:59`);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 422 });
    }

    const records = await listInspectionsSince(from, {
      until: to,
      ...(areaId === null || areaId === '' ? {} : { areaId }),
    });

    if (format !== 'csv') {
      return NextResponse.json(records);
    }

    const header = [
      'Date',
      'Time',
      'Area',
      'Van',
      'Driver',
      'Inspector',
      'Status',
      'Dispatch held',
      'Temperature C',
      'Failed checks',
    ];

    const rows = records.map((record) => {
      const when = new Date(record.performedAt);
      return [
        csvCell(when.toISOString().slice(0, 10)),
        csvCell(when.toTimeString().slice(0, 5)),
        csvCell(record.areaName),
        csvCell(record.plate),
        csvCell(record.driverName),
        csvCell(record.inspectorName),
        csvCell(record.status),
        csvCell(record.dispatchBlocked ? 'Yes' : 'No'),
        csvCell(record.tempReadingC),
        csvCell(record.failedCount),
      ].join(',');
    });

    const csv = [header.map(csvCell).join(','), ...rows].join('\r\n');
    const filename = `van-checks-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
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
