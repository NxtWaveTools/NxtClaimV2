import { Info } from "lucide-react";
import { AI_DISCLAIMER_TEXT } from "@/core/constants/ui-text";

export function AIDisclaimer() {
  return (
    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
      <Info className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{AI_DISCLAIMER_TEXT}</span>
    </p>
  );
}
