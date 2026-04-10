import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { withAuth } from "@/core/http/with-auth";
import { clearSupabaseAuthTokenCookies } from "@/core/infra/supabase/supabase-auth-cookie-utils";
import { createSuccessResponse } from "@/types/api";

const logoutHandler = async (_request: NextRequest, context: { correlationId: string }) => {
  const response = NextResponse.json(
    createSuccessResponse({ loggedOut: true }, context.correlationId),
    {
      status: 200,
    },
  );

  const cookieStore = await cookies();
  clearSupabaseAuthTokenCookies({
    existingCookies: cookieStore.getAll(),
    setCookie: (name, value, options) => {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    },
  });

  return response;
};

export const POST = withAuth(logoutHandler);
