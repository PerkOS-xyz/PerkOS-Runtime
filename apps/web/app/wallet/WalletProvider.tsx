"use client";

import type { ReactNode } from "react";

import { WalletContext, disabledWallet } from "./context";
import { DynamicWallet } from "./DynamicWallet";

const dynamicEnvId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim() ?? "";

export function WalletProvider({ children }: { children: ReactNode }) {
  if (dynamicEnvId) return <DynamicWallet>{children}</DynamicWallet>;
  return <WalletContext value={disabledWallet}>{children}</WalletContext>;
}
