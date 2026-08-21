import { serviceClient } from './supabaseClients';

export type FleetEntry = {
  vanId: string;
  plate: string;
  tempMinC: number;
  tempMaxC: number;
  driverId: string;
  driverName: string;
  route: string;
};

type VanRow = {
  id: string;
  plate: string;
  temp_min_c: number;
  temp_max_c: number;
};

type DriverRow = {
  id: string;
  full_name: string;
  route: string | null;
  default_van: string | null;
};

/**
 * The van list the supervisor sees. A van with no assigned driver is
 * omitted rather than shown broken — an inspection needs a driver, and
 * an unpickable row on the list is just confusing at 06:30.
 */
export const listFleet = async (): Promise<FleetEntry[]> => {
  const db = serviceClient();

  const [vansResult, driversResult] = await Promise.all([
    db.from('vans').select('id, plate, temp_min_c, temp_max_c').eq('active', true).order('plate'),
    db.from('drivers').select('id, full_name, route, default_van').eq('active', true),
  ]);

  if (vansResult.error !== null) {
    throw new Error(`Could not load the fleet: ${vansResult.error.message}`);
  }
  if (driversResult.error !== null) {
    throw new Error(`Could not load drivers: ${driversResult.error.message}`);
  }

  const vans: VanRow[] = vansResult.data ?? [];
  const drivers: DriverRow[] = driversResult.data ?? [];

  return vans.flatMap((van) => {
    const driver = drivers.find((candidate) => candidate.default_van === van.id);
    if (driver === undefined) {
      return [];
    }
    return [
      {
        vanId: van.id,
        plate: van.plate,
        tempMinC: Number(van.temp_min_c),
        tempMaxC: Number(van.temp_max_c),
        driverId: driver.id,
        driverName: driver.full_name,
        route: driver.route ?? '',
      },
    ];
  });
};
