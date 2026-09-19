"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DynamicContextProvider, useDynamicContext, useIsLoggedIn } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors, isEthereumWallet } from "@dynamic-labs/ethereum";
import type { WalletClient } from "viem";
import { flog } from "../log";
import { WalletContext, type Wallet } from "./context";
import { purgeWalletConnect } from "./walletConnectStore";

// Mismo tablero que el resto de PerkOS: una sola lista de personas y de redes.
// Sin la variable no se monta nada y el app cae al conector anterior, asi que
// activar esto es un cambio de entorno, no de codigo.
const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim() ?? "";
const BASE_ID = 8453;

/** Red que ve el conector: Base por el RPC local del install (proxy a Alchemy,
 *  con el token que pone apiToken.ts). El RPC publico rechazaba las lecturas
 *  que hace la wallet antes de firmar. */
function baseNetwork() {
  const rpc = typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : "https://mainnet.base.org";
  return [
    {
      blockExplorerUrls: ["https://basescan.org"],
      chainId: BASE_ID,
      chainName: "Base",
      iconUrls: ["https://app.dynamic.xyz/assets/networks/base.svg"],
      name: "Base",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      networkId: BASE_ID,
      rpcUrls: [rpc],
      vanityName: "Base"
    }
  ];
}

export function DynamicWalletProvider({ children }: { children: ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: envId,
        walletConnectors: [EthereumWalletConnectors],
        // La persona conecta la wallet y ya: la sesion de PerkOS se abre
        // firmando nuestro propio nonce (/agents, api.perkos.xyz). Con el SIWE
        // de la casa firmaria dos veces por lo mismo.
        initialAuthenticationMode: "connect-only",
        overrides: { evmNetworks: baseNetwork() },
        appName: "PerkOS Floor",
        appLogoUrl: "/logo.png"
      }}
    >
      <Bridge>{children}</Bridge>
    </DynamicContextProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { primaryWallet, handleLogOut, setShowAuthFlow, sdkHasLoaded } = useDynamicContext();
  const loggedIn = useIsLoggedIn();
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  // El enlace puede caerse sin que la sesion se entere (el telefono cierra la
  // app de la wallet): se pregunta al conector, que es quien lo sabe.
  const [live, setLive] = useState(true);
  const logoutRef = useRef<Promise<void> | null>(null);

  const address = primaryWallet?.address ?? "";
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);

  useEffect(() => {
    let dropped = false;
    const check = async () => {
      if (!primaryWallet) { if (!dropped) setLive(false); return; }
      try {
        const ask = (primaryWallet as { isConnected?: () => Promise<boolean> }).isConnected;
        const ok = typeof ask === "function" ? await ask.call(primaryWallet) : true;
        if (!dropped) setLive(Boolean(ok));
      } catch {
        if (!dropped) setLive(true); // el conector no sabe responder: no se acusa de caido
      }
    };
    void check();
    const t = setInterval(() => void check(), 5000);
    return () => { dropped = true; clearInterval(t); };
  }, [primaryWallet]);

  const logout = useCallback(() => {
    if (logoutRef.current) return logoutRef.current;
    setLoggingOut(true);
    flog("info", "wallet: logout started");
    const p = Promise.resolve(handleLogOut())
      .then(() => flog("info", "wallet: session closed"))
      .catch((e: unknown) => flog("warn", `wallet: logout failed: ${(e as Error).message}`))
      .finally(() => { purgeWalletConnect(); logoutRef.current = null; setLoggingOut(false); });
    logoutRef.current = p;
    return p;
  }, [handleLogOut]);

  // Abrir el conector. Si queda una sesion vieja se cierra primero: con el
  // enlace de WalletConnect muerto, reutilizarla deja un QR que no emparejaba.
  const openLogin = useCallback(async (relink = false) => {
    setError("");
    if (logoutRef.current) await logoutRef.current;
    if (relink && (loggedIn || primaryWallet)) {
      flog("info", "wallet: relinking, closing the previous session first");
      await logout();
    }
    if (!loggedIn && !primaryWallet) purgeWalletConnect();
    flog("info", "wallet: connect flow");
    setShowAuthFlow(true);
  }, [logout, loggedIn, primaryWallet, setShowAuthFlow]);

  const signMessage = async (message: string): Promise<string> => {
    if (!primaryWallet || !isEvm) throw new Error("wallet_link_lost");
    const signature = await primaryWallet.signMessage(message);
    if (!signature) throw new Error("The wallet returned an empty signature");
    return signature;
  };

  const sendTransaction = async (tx: { to: `0x${string}`; data: `0x${string}`; value?: `0x${string}`; chainId: number }): Promise<`0x${string}`> => {
    if (!primaryWallet || !isEvm) throw new Error("wallet_link_lost");
    if (!isEthereumWallet(primaryWallet)) throw new Error("wallet_link_lost");
    const chain = Number((primaryWallet as { chain?: string | number }).chain ?? NaN);
    flog("info", `wallet tx: ${primaryWallet.connector?.name ?? "?"} · chain ${String(chain || "?")}${chain === tx.chainId ? "" : ` -> switching to ${tx.chainId}`}`);
    // Con WalletConnect cada peticion viaja al telefono: no se pide el cambio
    // de red si la wallet ya esta donde toca.
    if (chain !== tx.chainId) { await primaryWallet.switchNetwork(tx.chainId); flog("info", "wallet tx: chain switched"); }
    const client = (await primaryWallet.getWalletClient()) as WalletClient;
    flog("info", "wallet tx: request sent to the wallet, waiting for confirmation");
    const hash = await client.sendTransaction({
      account: client.account ?? (address as `0x${string}`),
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
      chain: null
    } as Parameters<WalletClient["sendTransaction"]>[0]);
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet returned no transaction hash");
    return hash as `0x${string}`;
  };

  const connector = primaryWallet?.connector;
  const embedded = Boolean((connector as { isEmbeddedWallet?: boolean } | undefined)?.isEmbeddedWallet);
  const key = `${connector?.key ?? ""} ${connector?.name ?? ""}`;
  const signWhere: Wallet["signWhere"] = !primaryWallet ? "" : embedded ? "embedded" : /wallet\s?connect/i.test(key) ? "phone" : "extension";
  const walletName = String(connector?.name ?? "").replace(/^WalletConnect$/i, "");
  const connected = Boolean(isEvm && !loggingOut);
  const canSign = Boolean(connected && live);

  const value = useMemo<Wallet>(
    () => ({
      enabled: true,
      loaded: sdkHasLoaded,
      connected,
      proven: connected,
      address: loggingOut ? "" : address,
      providers: [],
      awaitingOtp: false,
      busy: !sdkHasLoaded || loggingOut,
      error,
      qr: "",
      open: () => { void openLogin(); },
      sendEmail: () => { void openLogin(); },
      verifyOtp: () => undefined,
      startQr: () => { void openLogin(); },
      prove: () => undefined,
      forget: () => { void logout(); },
      logout,
      signMessage,
      sendTransaction,
      signWhere,
      walletName,
      canSign,
      reconnect: () => { void openLogin(true); }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, connected, error, logout, openLogin, loggingOut, sdkHasLoaded, signWhere, walletName, canSign]
  );
  return <WalletContext value={value}>{children}</WalletContext>;
}
