import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/core/config/server-env";
import { isAllowedEmailDomain } from "@/core/config/allowed-domains";
import { applySupabaseAuthCookies } from "@/core/infra/supabase/supabase-auth-cookie-utils";

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const successRedirectUrl = new URL("/dashboard", request.url);
  const failureRedirectUrl = new URL("/auth/login?error=sso-failed", request.url);

  if (!code) {
    return NextResponse.redirect(failureRedirectUrl);
  }

  const response = NextResponse.redirect(successRedirectUrl);
  const cookieStore = await cookies();

  const supabase = createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          applySupabaseAuthCookies({
            existingCookies: cookieStore.getAll(),
            cookiesToSet,
            setCookie: (name, value, options) => {
              response.cookies.set(name, value, options);
            },
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(failureRedirectUrl);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmailDomain(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(failureRedirectUrl);
  }

  return response;
}
