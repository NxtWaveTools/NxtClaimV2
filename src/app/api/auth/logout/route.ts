import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { clearSupabaseAuthTokenCookies } from "@/core/infra/supabase/supabase-auth-cookie-utils";
import { createSuccessResponse } from "@/types/api";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  const response = NextResponse.json(createSuccessResponse({ loggedOut: true }, correlationId), {
    status: 200,
  });

  const cookieStore = await cookies();
  clearSupabaseAuthTokenCookies({
    existingCookies: cookieStore.getAll(),
    setCookie: (name, value, options) => {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    },
  });

  return response;
}
