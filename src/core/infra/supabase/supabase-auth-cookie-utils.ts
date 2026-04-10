import { serverEnv } from "@/core/config/server-env";

type CookieDescriptor = {
  name: string;
};

type CookieToSet<TOptions> = {
  name: string;
  value: string;
  options?: TOptions;
};

type SetCookie<TOptions> = (name: string, value: string, options?: TOptions) => void;

const SUPABASE_AUTH_TOKEN_COOKIE_NAME_REGEX = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i;
const EXPIRED_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 0,
  expires: new Date(0),
};

function resolveCurrentProjectRef(): string | null {
  try {
    const host = new URL(serverEnv.NEXT_PUBLIC_SUPABASE_URL).hostname;
    const projectRef = host.split(".")[0]?.trim().toLowerCase();
    return projectRef && projectRef.length > 0 ? projectRef : null;
  } catch {
    return null;
  }
}

const CURRENT_PROJECT_REF = resolveCurrentProjectRef();
const CURRENT_AUTH_TOKEN_PREFIX = CURRENT_PROJECT_REF
  ? `sb-${CURRENT_PROJECT_REF}-auth-token`
  : null;

function isSupabaseAuthTokenCookieName(name: string): boolean {
  return SUPABASE_AUTH_TOKEN_COOKIE_NAME_REGEX.test(name);
}

function isCurrentProjectAuthTokenCookieName(name: string): boolean {
  return CURRENT_AUTH_TOKEN_PREFIX ? name.startsWith(CURRENT_AUTH_TOKEN_PREFIX) : false;
}

export function applySupabaseAuthCookies<TOptions>(params: {
  existingCookies: CookieDescriptor[];
  cookiesToSet: CookieToSet<TOptions>[];
  setCookie: SetCookie<TOptions>;
}): void {
  const incomingNames = new Set(params.cookiesToSet.map((cookie) => cookie.name));
  const staleCookieNames = new Set<string>();

  for (const cookie of params.existingCookies) {
    if (!isSupabaseAuthTokenCookieName(cookie.name)) {
      continue;
    }

    if (CURRENT_AUTH_TOKEN_PREFIX && !isCurrentProjectAuthTokenCookieName(cookie.name)) {
      staleCookieNames.add(cookie.name);
      continue;
    }

    if (isCurrentProjectAuthTokenCookieName(cookie.name) && !incomingNames.has(cookie.name)) {
      staleCookieNames.add(cookie.name);
    }
  }

  for (const cookieName of staleCookieNames) {
    params.setCookie(cookieName, "", EXPIRED_COOKIE_OPTIONS as TOptions);
  }

  for (const cookie of params.cookiesToSet) {
    params.setCookie(cookie.name, cookie.value, cookie.options);
  }
}

export function clearSupabaseAuthTokenCookies<TOptions>(params: {
  existingCookies: CookieDescriptor[];
  setCookie: SetCookie<TOptions>;
}): void {
  for (const cookie of params.existingCookies) {
    if (!isSupabaseAuthTokenCookieName(cookie.name)) {
      continue;
    }

    params.setCookie(cookie.name, "", EXPIRED_COOKIE_OPTIONS as TOptions);
  }
}
