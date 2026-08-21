import { NextResponse } from 'next/server';
import { sessionClient } from '@/lib/supabaseClients';

/**
 * Google sends the user back here. The @calo.app rule is enforced by the
 * handle_new_user trigger in the database, so a personal Gmail fails at
 * the exchange — that error is surfaced on the login page rather than
 * shown as a stack trace.
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code === null) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await sessionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error !== null) {
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  return NextResponse.redirect(origin);
};
