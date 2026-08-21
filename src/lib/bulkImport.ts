import { serviceClient } from './supabaseClients';
import { listAreas, listDrivers, listVans } from './fleetRepository';
import type { Profile } from './types';

/**
 * Bulk import for vans and staff.
 *
 * Every import is validated and previewed before anything is written.
 * Loading eighty rows blind and finding out afterwards that half went to
 * the wrong emirate is the failure this exists to prevent.
 */

export type RowIssue = { line: number; input: string; reason: string };

export type VanDraft = { line: number; plate: string; areaId: string; areaName: string };

export type StaffDraft = {
  line: number;
  fullName: string;
  staffRole: 'driver' | 'helper';
  areaId: string | null;
  areaName: string;
  vanId: string | null;
  plate: string;
  partnerName: string;
};

export type Preview<T> = { valid: T[]; issues: RowIssue[] };

/**
 * Handles both comma and tab delimiters, quoted fields, CRLF, and the
 * BOM Excel writes at the start of a CSV. Pasting straight out of a
 * spreadsheet gives tabs; a saved file gives commas.
 */
export const parseDelimited = (text: string): { cells: string[]; line: number }[] => {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: { cells: string[]; line: number }[] = [];

  let cell = '';
  let cells: string[] = [];
  let inQuotes = false;
  let line = 1;
  let startLine = 1;

  const pushCell = (): void => {
    cells.push(cell.trim());
    cell = '';
  };

  const pushRow = (): void => {
    pushCell();
    if (cells.some((value) => value !== '')) {
      rows.push({ cells, line: startLine });
    }
    cells = [];
    startLine = line + 1;
  };

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === '\t') {
      pushCell();
    } else if (char === '\n') {
      pushRow();
      line += 1;
    } else {
      cell += char;
    }
  }

  if (cell !== '' || cells.length > 0) {
    pushRow();
  }

  return rows;
};

/** A first row naming the columns is optional, so detect and drop it. */
const dropHeader = (
  rows: { cells: string[]; line: number }[],
  known: string[],
): { cells: string[]; line: number }[] => {
  const first = rows[0];
  if (first === undefined) {
    return rows;
  }
  const looksLikeHeader = first.cells.some((cell) => known.includes(cell.toLowerCase()));
  return looksLikeHeader ? rows.slice(1) : rows;
};

const normalise = (value: string): string => value.trim().toLowerCase();

export const previewVans = async (text: string): Promise<Preview<VanDraft>> => {
  const areas = await listAreas(true);
  const existing = await listVans(true);

  const rows = dropHeader(parseDelimited(text), ['plate', 'van', 'area', 'emirate']);
  const valid: VanDraft[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const raw = row.cells.join(', ');
    const plate = (row.cells[0] ?? '').toUpperCase();
    const areaText = row.cells[1] ?? '';

    if (plate === '') {
      issues.push({ line: row.line, input: raw, reason: 'No plate' });
      continue;
    }

    const area = areas.find(
      (candidate) =>
        normalise(candidate.name) === normalise(areaText) ||
        normalise(candidate.code) === normalise(areaText),
    );

    if (area === undefined) {
      issues.push({
        line: row.line,
        input: raw,
        reason: areaText === '' ? 'No area given' : `Unknown area "${areaText}"`,
      });
      continue;
    }
    if (existing.some((van) => van.plate === plate)) {
      issues.push({ line: row.line, input: raw, reason: 'Plate already exists' });
      continue;
    }
    if (seen.has(plate)) {
      issues.push({ line: row.line, input: raw, reason: 'Duplicate plate in this file' });
      continue;
    }

    seen.add(plate);
    valid.push({ line: row.line, plate, areaId: area.id, areaName: area.name });
  }

  return { valid, issues };
};

export const previewStaff = async (text: string): Promise<Preview<StaffDraft>> => {
  const [areas, vans, staff] = await Promise.all([listAreas(true), listVans(true), listDrivers(true)]);

  const rows = dropHeader(parseDelimited(text), [
    'name',
    'role',
    'area',
    'van',
    'plate',
    'rides with',
    'rides_with',
    'partner',
  ]);

  const valid: StaffDraft[] = [];
  const issues: RowIssue[] = [];

  // Two passes: a helper may name a driver that appears later in the same
  // file, so drivers are resolved first.
  const driverRows = rows.filter((row) => normalise(row.cells[1] ?? 'driver') !== 'helper');
  const helperRows = rows.filter((row) => normalise(row.cells[1] ?? 'driver') === 'helper');

  const takenVans = new Set(
    staff.filter((person) => person.defaultVanId !== null).map((person) => person.defaultVanId),
  );

  for (const row of driverRows) {
    const raw = row.cells.join(', ');
    const fullName = row.cells[0] ?? '';
    const areaText = row.cells[2] ?? '';
    const plateText = (row.cells[3] ?? '').toUpperCase();

    if (fullName === '') {
      issues.push({ line: row.line, input: raw, reason: 'No name' });
      continue;
    }

    const area = areas.find(
      (candidate) =>
        normalise(candidate.name) === normalise(areaText) ||
        normalise(candidate.code) === normalise(areaText),
    );
    if (area === undefined) {
      issues.push({
        line: row.line,
        input: raw,
        reason: areaText === '' ? 'No area given' : `Unknown area "${areaText}"`,
      });
      continue;
    }

    let vanId: string | null = null;
    if (plateText !== '') {
      const van = vans.find((candidate) => candidate.plate === plateText);
      if (van === undefined) {
        issues.push({ line: row.line, input: raw, reason: `Unknown van "${plateText}"` });
        continue;
      }
      if (van.areaId !== area.id) {
        issues.push({
          line: row.line,
          input: raw,
          reason: `${plateText} is not in ${area.name}`,
        });
        continue;
      }
      if (takenVans.has(van.id)) {
        issues.push({ line: row.line, input: raw, reason: `${plateText} already has a driver` });
        continue;
      }
      takenVans.add(van.id);
      vanId = van.id;
    }

    valid.push({
      line: row.line,
      fullName,
      staffRole: 'driver',
      areaId: area.id,
      areaName: area.name,
      vanId,
      plate: plateText,
      partnerName: '',
    });
  }

  const pairedDrivers = new Set(
    staff.filter((person) => person.staffRole === 'helper').map((person) => person.partnerId),
  );

  for (const row of helperRows) {
    const raw = row.cells.join(', ');
    const fullName = row.cells[0] ?? '';
    const partnerName = row.cells[4] ?? '';

    if (fullName === '') {
      issues.push({ line: row.line, input: raw, reason: 'No name' });
      continue;
    }
    if (partnerName === '') {
      issues.push({ line: row.line, input: raw, reason: 'A helper must name their driver' });
      continue;
    }

    const fromFile = valid.find(
      (draft) => draft.staffRole === 'driver' && normalise(draft.fullName) === normalise(partnerName),
    );
    const fromDb = staff.find(
      (person) => person.staffRole === 'driver' && normalise(person.fullName) === normalise(partnerName),
    );

    if (fromFile === undefined && fromDb === undefined) {
      issues.push({ line: row.line, input: raw, reason: `No driver called "${partnerName}"` });
      continue;
    }
    if (fromDb !== undefined && pairedDrivers.has(fromDb.id)) {
      issues.push({ line: row.line, input: raw, reason: `${partnerName} already has a helper` });
      continue;
    }

    valid.push({
      line: row.line,
      fullName,
      staffRole: 'helper',
      areaId: fromFile?.areaId ?? fromDb?.areaId ?? null,
      areaName: fromFile?.areaName ?? '',
      vanId: fromFile?.vanId ?? fromDb?.defaultVanId ?? null,
      plate: fromFile?.plate ?? '',
      partnerName,
    });
  }

  return { valid: valid.sort((a, b) => a.line - b.line), issues };
};

const audit = async (actor: Profile, action: string, count: number): Promise<void> => {
  await serviceClient().from('audit_log').insert({
    actor_id: actor.id,
    action,
    entity: 'bulk_import',
    after: { rows: count },
  });
};

export const importVans = async (drafts: VanDraft[], actor: Profile): Promise<number> => {
  if (drafts.length === 0) {
    return 0;
  }

  const { error } = await serviceClient()
    .from('vans')
    .insert(
      drafts.map((draft) => ({
        plate: draft.plate,
        area_id: draft.areaId,
        temp_min_c: 0,
        temp_max_c: 5,
      })),
    );

  if (error !== null) {
    throw new Error(`Import failed: ${error.message}`);
  }

  await audit(actor, 'vans.bulk_imported', drafts.length);
  return drafts.length;
};

export const importStaff = async (drafts: StaffDraft[], actor: Profile): Promise<number> => {
  const db = serviceClient();
  const drivers = drafts.filter((draft) => draft.staffRole === 'driver');
  const helpers = drafts.filter((draft) => draft.staffRole === 'helper');

  const nameToId = new Map<string, string>();

  if (drivers.length > 0) {
    const { data, error } = await db
      .from('drivers')
      .insert(
        drivers.map((draft) => ({
          full_name: draft.fullName,
          staff_role: 'driver',
          partner_id: null,
          area_id: draft.areaId,
          default_van: draft.vanId,
        })),
      )
      .select('id, full_name');

    if (error !== null || data === null) {
      throw new Error(`Driver import failed: ${error?.message ?? 'unknown'}`);
    }
    for (const row of data as { id: string; full_name: string }[]) {
      nameToId.set(normalise(row.full_name), row.id);
    }
  }

  if (helpers.length > 0) {
    // Drivers already in the database are not in nameToId, so look up
    // anything the first pass did not create.
    const existing = await listDrivers(true);
    for (const person of existing) {
      if (person.staffRole === 'driver' && !nameToId.has(normalise(person.fullName))) {
        nameToId.set(normalise(person.fullName), person.id);
      }
    }

    const rows = helpers.flatMap((draft) => {
      const partnerId = nameToId.get(normalise(draft.partnerName));
      if (partnerId === undefined) {
        return [];
      }
      return [
        {
          full_name: draft.fullName,
          staff_role: 'helper',
          partner_id: partnerId,
          area_id: draft.areaId,
          default_van: draft.vanId,
        },
      ];
    });

    if (rows.length > 0) {
      const { error } = await db.from('drivers').insert(rows);
      if (error !== null) {
        throw new Error(`Helper import failed: ${error.message}`);
      }
    }
  }

  await audit(actor, 'drivers.bulk_imported', drafts.length);
  return drafts.length;
};
