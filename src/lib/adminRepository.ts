import { serviceClient } from './supabaseClients';
import { ValidationError } from './inspectionRepository';
import type { Profile } from './types';

/**
 * Manager and admin edits to reference data.
 *
 * Nothing here hard-deletes. A van or driver referenced by an inspection
 * cannot be removed without taking the audit trail with it, so
 * everything is deactivated instead and simply stops appearing in the
 * supervisor's list.
 */

export type Entity = 'areas' | 'vans' | 'drivers';

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
};

const optionalUuid = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

type Payload = Record<string, unknown>;

const buildAreaRow = (payload: Payload): Payload => ({
  name: requireText(payload.name, 'Area name'),
  code: requireText(payload.code, 'Area code').toUpperCase().slice(0, 4),
  sort_order: typeof payload.sortOrder === 'number' ? payload.sortOrder : 100,
});

// Every van runs 0-5 °C, so the range is not asked for. The columns
// stay in the schema for a future exception.
const buildVanRow = (payload: Payload): Payload => ({
  plate: requireText(payload.plate, 'Plate').toUpperCase(),
  area_id: optionalUuid(payload.areaId),
  temp_min_c: 0,
  temp_max_c: 5,
});

/**
 * A helper rides with one driver, so their van and area are copied from
 * that driver rather than entered again. Two places to record the same
 * fact is two places for it to drift.
 */
const buildDriverRow = (payload: Payload): Payload => {
  const staffRole = payload.staffRole === 'helper' ? 'helper' : 'driver';

  if (staffRole === 'helper') {
    const partnerId = optionalUuid(payload.partnerId);
    if (partnerId === null) {
      throw new ValidationError('A helper must be paired with a driver');
    }
    return {
      full_name: requireText(payload.fullName, 'Name'),
      staff_role: 'helper',
      partner_id: partnerId,
      area_id: optionalUuid(payload.areaId),
      default_van: optionalUuid(payload.defaultVanId),
    };
  }

  return {
    full_name: requireText(payload.fullName, 'Name'),
    staff_role: 'driver',
    partner_id: null,
    area_id: optionalUuid(payload.areaId),
    default_van: optionalUuid(payload.defaultVanId),
  };
};

const BUILDERS: Record<Entity, (payload: Payload) => Payload> = {
  areas: buildAreaRow,
  vans: buildVanRow,
  drivers: buildDriverRow,
};

const audit = async (
  actor: Profile,
  action: string,
  entity: string,
  entityId: string | null,
  after: Payload | null,
): Promise<void> => {
  await serviceClient().from('audit_log').insert({
    actor_id: actor.id,
    action,
    entity,
    entity_id: entityId,
    after,
  });
};

export const createRecord = async (
  entity: Entity,
  payload: Payload,
  actor: Profile,
): Promise<{ id: string }> => {
  const row = BUILDERS[entity](payload);

  const { data, error } = await serviceClient()
    .from(entity)
    .insert(row)
    .select('id')
    .single<{ id: string }>();

  if (error !== null || data === null) {
    if (error?.code === '23505') {
      throw new ValidationError('That already exists — check for a duplicate name, plate or ID');
    }
    throw new Error(error?.message ?? 'Could not save');
  }

  await audit(actor, `${entity}.created`, entity, data.id, row);
  return { id: data.id };
};

export const updateRecord = async (
  entity: Entity,
  id: string,
  payload: Payload,
  actor: Profile,
): Promise<void> => {
  const row = BUILDERS[entity](payload);

  const { error } = await serviceClient().from(entity).update(row).eq('id', id);

  if (error !== null) {
    if (error.code === '23505') {
      throw new ValidationError('That already exists — check for a duplicate name, plate or ID');
    }
    throw new Error(error.message);
  }

  await audit(actor, `${entity}.updated`, entity, id, row);
};

/**
 * Deactivate, never delete. Inspections reference vans and drivers, and
 * a hard delete would either fail on the foreign key or orphan history.
 */
export const setActive = async (
  entity: Entity,
  id: string,
  active: boolean,
  actor: Profile,
): Promise<void> => {
  const { error } = await serviceClient().from(entity).update({ active }).eq('id', id);

  if (error !== null) {
    throw new Error(error.message);
  }

  await audit(actor, active ? `${entity}.reactivated` : `${entity}.deactivated`, entity, id, {
    active,
  });
};
