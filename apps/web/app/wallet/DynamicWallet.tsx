"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DynamicContextProvider, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";

import { WalletContext, type Wallet } from "./context";

const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim() ?? "";
const BASE_ID = 8453;
const LOAD_TIMEOUT_MS = 15_000;

const BASE = {
  blockExplorerUrls: ["https://basescan.org"],
  chainId: BASE_ID,
  chainName: "Base",
  iconUrls: ["https://app.dynamic.xyz/assets/networks/base.svg"],
  name: "Base",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  networkId: BASE_ID,
  rpcUrls: ["https://mainnet.base.org"],
  vanityName: "Base"
};

export function DynamicWallet({ children }: { children: ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: envId,
        walletConnectors: [EthereumWalletConnectors],
        // Connect only: the PerkOS session is opened by signing the PerkOS
        // nonce, so the connector's own sign-in message is not needed.
        initialAuthenticationMode: "connect-only",
        overrides: { evmNetworks: [BASE] },
        appName: "PerkOS Runtime",
        appLogoUrl: "/logo.png"
      }}
    >
      <Bridge>{children}</Bridge>
    </DynamicContextProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { primaryWallet, handleLogOut, setShowAuthFlow, sdkHasLoaded } = useDynamicContext();
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  // The SDK does not report a failed settings load; without this the button waits forever.
  useEffect(() => {
    if (sdkHasLoaded) return;
    const t = setTimeout(() => {
      setError(`The wallet service did not load. Add ${window.location.origin} to the allowed origins of this Dynamic environment.`);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [sdkHasLoaded]);

  const raw = primaryWallet?.address ?? "";
  const address = /^0x[0-9a-fA-F]{40}$/.test(raw) && !loggingOut ? raw : "";

  const logout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await handleLogOut();
    } finally {
      setLoggingOut(false);
    }
  }, [handleLogOut]);

  const signMessage = useCallback(
    async (message: string) => {
      if (!primaryWallet || !address) throw new Error("No wallet connected");
      const signature = await primaryWallet.signMessage(message);
      if (!signature) throw new Error("The wallet returned an empty signature");
      return signature;
    },
    [primaryWallet, address]
  );

  const value = useMemo<Wallet>(
    () => ({
      enabled: true,
      loaded: sdkHasLoaded,
      connected: Boolean(address),
      address,
      busy: !sdkHasLoaded || loggingOut,
      error,
      open: () => {
        setError("");
        setShowAuthFlow(true);
      },
      logout,
      signMessage
    }),
    [address, error, logout, loggingOut, sdkHasLoaded, setShowAuthFlow, signMessage]
  );

  return <WalletContext value={value}>{children}</WalletContext>;
}
