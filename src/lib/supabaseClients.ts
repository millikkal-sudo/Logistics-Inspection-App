import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * PORT BOUNDARY — Supabase-specific.
 *
 * If this ever moves off Supabase, this file is replaced by a Postgres
 * pool and an auth helper. Nothing outside this file and
 * supabaseBrowser.ts imports a vendor SDK.
 */

const requireEnv = (value: string | undefined, name: string): string => {
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
};

/** Reads the signed-in user's session from cookies. Subject to RLS. */
export const sessionClient = async (): Promise<SupabaseClient> => {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. The middleware
            // refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
};

/**
 * Bypasses RLS. Server-side only — never import this into a client
 * component. Every caller must do its own authorization check first.
 */
export const serviceClient = (): SupabaseClient =>
  createClient(
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
