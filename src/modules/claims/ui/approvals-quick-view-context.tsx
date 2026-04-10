"use client";

import { createContext, useContext, type ReactNode } from "react";

type ApprovalsQuickViewControls = {
  closePanel: () => void;
};

const ApprovalsQuickViewContext = createContext<ApprovalsQuickViewControls | null>(null);

export function ApprovalsQuickViewProvider({
  value,
  children,
}: {
  value: ApprovalsQuickViewControls;
  children: ReactNode;
}) {
  return (
    <ApprovalsQuickViewContext.Provider value={value}>
      {children}
    </ApprovalsQuickViewContext.Provider>
  );
}

export function useApprovalsQuickViewControls(): ApprovalsQuickViewControls | null {
  return useContext(ApprovalsQuickViewContext);
}
