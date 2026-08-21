import { serviceClient } from './supabaseClients';
import type { Area, Driver, Van } from './types';

export type FleetEntry = {
  vanId: string;
  plate: string;
  areaId: string | null;
  tempMinC: number;
  tempMaxC: number;
  driverId: string;
  driverName: string;
  route: string;
};

type AreaRow = { id: string; name: string; code: string; active: boolean; sort_order: number };
type VanRow = {
  id: string;
  plate: string;
  area_id: string | null;
  temp_min_c: number;
  temp_max_c: number;
  active: boolean;
};
type DriverRow = {
  id: string;
  employee_id: string;
  full_name: string;
  route: string | null;
  area_id: string | null;
  default_van: string | null;
  active: boolean;
};

const toArea = (row: AreaRow): Area => ({
  id: row.id,
  name: row.name,
  code: row.code,
  active: row.active,
  sortOrder: row.sort_order,
});

export const listAreas = async (includeInactive = false): Promise<Area[]> => {
  let query = serviceClient()
    .from('areas')
    .select('id, name, code, active, sort_order')
    .order('sort_order');

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;
  if (error !== null) {
    throw new Error(`Could not load areas: ${error.message}`);
  }
  return (data ?? []).map(toArea);
};

export const listVans = async (includeInactive = false): Promise<Van[]> => {
  let query = serviceClient()
    .from('vans')
    .select('id, plate, area_id, temp_min_c, temp_max_c, active')
    .order('plate');

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;
  if (error !== null) {
    throw new Error(`Could not load vans: ${error.message}`);
  }
  return (data ?? []).map((row: VanRow) => ({
    id: row.id,
    plate: row.plate,
    areaId: row.area_id,
    tempMinC: Number(row.temp_min_c),
    tempMaxC: Number(row.temp_max_c),
    active: row.active,
  }));
};

export const listDrivers = async (includeInactive = false): Promise<Driver[]> => {
  let query = serviceClient()
    .from('drivers')
    .select('id, employee_id, full_name, route, area_id, default_van, active')
    .order('full_name');

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;
  if (error !== null) {
    throw new Error(`Could not load drivers: ${error.message}`);
  }
  return (data ?? []).map((row: DriverRow) => ({
    id: row.id,
    employeeId: row.employee_id,
    fullName: row.full_name,
    route: row.route,
    areaId: row.area_id,
    defaultVanId: row.default_van,
    active: row.active,
  }));
};

/**
 * The van list the supervisor picks from. A van with no assigned driver
 * is omitted — an inspection needs a driver, and an unpickable row on
 * the list is just confusing at 06:30.
 */
export const listFleet = async (): Promise<FleetEntry[]> => {
  const [vans, drivers] = await Promise.all([listVans(), listDrivers()]);

  return vans.flatMap((van) => {
    const driver = drivers.find((candidate) => candidate.defaultVanId === van.id);
    if (driver === undefined) {
      return [];
    }
    return [
      {
        vanId: van.id,
        plate: van.plate,
        areaId: van.areaId,
        tempMinC: van.tempMinC,
        tempMaxC: van.tempMaxC,
        driverId: driver.id,
        driverName: driver.fullName,
        route: driver.route ?? '',
      },
    ];
  });
};
