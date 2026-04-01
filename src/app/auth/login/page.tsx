import { Suspense } from "react";
import { LoginPageContent } from "@/modules/auth/ui/login-page-content";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
