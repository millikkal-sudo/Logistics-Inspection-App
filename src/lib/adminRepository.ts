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

const optionalText = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
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

const buildVanRow = (payload: Payload): Payload => {
  const min = typeof payload.tempMinC === 'number' ? payload.tempMinC : 0;
  const max = typeof payload.tempMaxC === 'number' ? payload.tempMaxC : 5;

  if (min >= max) {
    throw new ValidationError('The minimum temperature must be below the maximum');
  }

  return {
    plate: requireText(payload.plate, 'Plate').toUpperCase(),
    area_id: optionalUuid(payload.areaId),
    temp_min_c: min,
    temp_max_c: max,
  };
};

const buildDriverRow = (payload: Payload): Payload => ({
  employee_id: requireText(payload.employeeId, 'Employee ID'),
  full_name: requireText(payload.fullName, 'Driver name'),
  route: optionalText(payload.route),
  area_id: optionalUuid(payload.areaId),
  default_van: optionalUuid(payload.defaultVanId),
});

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
