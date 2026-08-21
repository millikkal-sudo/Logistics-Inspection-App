import { NextResponse } from 'next/server';
import { sessionClient } from '@/lib/supabaseClients';

export const POST = async (request: Request): Promise<NextResponse> => {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
};
