import { cache } from "react";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";

/**
 * React.cache()-wrapped getCurrentUser. Deduplicates multiple calls within
 * a single RSC render pass (e.g. outer page + inner Suspense boundary).
 */
export const getCachedCurrentUser = cache(async () => {
  const authRepository = new SupabaseServerAuthRepository();
  return authRepository.getCurrentUser();
});
