import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session cookie and keeps signed-out users off
 * the app. Convenience, not security — every API route re-checks
 * identity for itself.
 *
 * Middleware runs on every request, so a throw here takes the whole site
 * down with an opaque 500. Nothing in this file is allowed to throw: on
 * any failure it lets the request through and lets the page render a
 * real error instead.
 */
export const middleware = async (request: NextRequest): Promise<NextResponse> => {
  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/auth');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Misconfigured deploy. Send everyone to /login, which renders a
  // readable message rather than crashing the edge runtime.
  if (url === undefined || url === '' || key === undefined || key === '') {
    if (isAuthRoute) {
      return NextResponse.next();
    }
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('error', 'config');
    return NextResponse.redirect(redirect);
  }

  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const { data } = await supabase.auth.getUser();

    if (data.user === null && !isAuthRoute) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = '/login';
      return NextResponse.redirect(redirect);
    }

    return response;
  } catch {
    // Supabase unreachable, malformed URL, expired token — let the
    // request through rather than 500 the entire app.
    return NextResponse.next();
  }
};

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'],
};
