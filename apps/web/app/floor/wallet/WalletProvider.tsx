"use client";

import { type ReactNode } from "react";
import { WalletContext, disabledWallet } from "./context";
import { PrivyWalletProvider } from "./WalletProviderPrivy";
import { DynamicWalletProvider } from "./WalletProviderDynamic";

// Que conector abre la ventana de sign in. Con NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID
// puesta se usa el tablero compartido de PerkOS (una sola lista de personas y de
// redes para todas las apps); sin ella el app se comporta exactamente como antes.
// NEXT_PUBLIC_WALLET_CONNECTOR=legacy fuerza el anterior aunque la id este puesta,
// que es la vuelta atras en un minuto si algo se tuerce con un telefono.
const dynamicEnvId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim() ?? "";
const forced = process.env.NEXT_PUBLIC_WALLET_CONNECTOR?.trim().toLowerCase() ?? "";
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

export function WalletProvider({ children }: { children: ReactNode }) {
  const useDynamic = forced === "dynamic" || (Boolean(dynamicEnvId) && forced !== "legacy");
  if (useDynamic && dynamicEnvId) return <DynamicWalletProvider>{children}</DynamicWalletProvider>;
  if (privyAppId) return <PrivyWalletProvider>{children}</PrivyWalletProvider>;
  return <WalletContext value={disabledWallet}>{children}</WalletContext>;
}
