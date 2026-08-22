import { redirect } from 'next/navigation';
import { VanCheckApp } from '@/components/VanCheckApp';
import { listActions, listAreas, listCauses, listFleet } from '@/lib/fleetRepository';
import { listCheckItems, listInspectionsSince } from '@/lib/inspectionRepository';
import { currentProfile, ForbiddenError, UnauthorizedError } from '@/lib/session';

/**
 * Everything the phone needs, fetched in one server render. The
 * supervisor opens this at 06:30 on warehouse wifi — a waterfall of
 * client fetches would be felt.
 */
const HomePage = async () => {
  try {
    const profile = await currentProfile();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [areas, fleet, checkItems, causes, actions, today] = await Promise.all([
      listAreas(),
      listFleet(),
      listCheckItems(),
      listCauses(),
      listActions(),
      listInspectionsSince(startOfDay),
    ]);

    return (
      <VanCheckApp
        profile={profile}
        areas={areas}
        fleet={fleet}
        checkItems={checkItems}
        causes={causes}
        actions={actions}
        initialToday={today}
        canManage={profile.role === 'manager' || profile.role === 'admin'}
      />
    );
  } catch (cause: unknown) {
    if (cause instanceof UnauthorizedError) {
      redirect('/login');
    }
    if (cause instanceof ForbiddenError) {
      redirect('/login?error=inactive');
    }
    throw cause;
  }
};

export const dynamic = 'force-dynamic';

export default HomePage;
