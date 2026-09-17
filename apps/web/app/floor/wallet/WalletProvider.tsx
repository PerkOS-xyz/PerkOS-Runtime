"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { flog } from "../log";
import { PrivyProvider, useLogin, usePrivy, useSignMessage, useWallets } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { WalletContext, disabledWallet, type Wallet } from "./context";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";
// Sin esto Privy inicializa WalletConnect a medias y revienta al montar con
// "undefined.setDefaultChain" y "undefined.request" (switchEthereumChain).
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

const wagmi = createConfig({
  chains: [base],
  transports: { [base.id]: http(typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : undefined) }
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [query] = useState(() => new QueryClient());
  if (!appId) {
    return <WalletContext value={disabledWallet}>{children}</WalletContext>;
  }
  // URL absoluta (viem la exige); el parche de fetch de apiToken.ts le pone el token.
  const rpcUrl = typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : "";
  const floorBase = rpcUrl ? { ...base, rpcUrls: { ...base.rpcUrls, default: { http: [rpcUrl] }, privyWalletOverride: { http: [rpcUrl] } } } : base;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethodsAndOrder: {
          primary: ["email", "google"],
          // En Electron no hay extensiones. La entrada "metamask" de Privy usa el
          // MetaMask SDK (QR propio) que aqui no completa el pairing: el primer
          // login fallaba y recien el segundo, ya como "WalletConnect" con el
          // logo de MetaMask, entraba. MetaMask Mobile va siempre por
          // WalletConnect (wallet_connect_qr); Coinbase Wallet tiene su SDK.
          overflow: ["wallet_connect_qr", "coinbase_wallet", "detected_ethereum_wallets"]
        },
        // Con walletConnectCloudProjectId forzabamos el proyecto nuevo (ae9952...)
        // y el pairing por QR dejo de completar: el origen 127.0.0.1:3847 no esta
        // autorizado ahi. Sin override, Privy usa el proyecto WC de su dashboard,
        // que es con el que el login por QR funciono hoy.
        ...(process.env.NEXT_PUBLIC_WALLETCONNECT_FORCE === "1" && wcProjectId
          ? { walletConnectCloudProjectId: wcProjectId }
          : {}),
        externalWallets: { walletConnect: { enabled: true } },
        // Base por el RPC del install (proxy local a Alchemy): el RPC publico
        // rechazaba las lecturas del proveedor de la wallet y la firma no salia.
        supportedChains: [floorBase],
        defaultChain: floorBase,
        // Con "off", quien entra por email o Google se autentica pero no recibe
        // ninguna wallet: user.wallet queda vacio, connected nunca pasa a true y
        // el wizard se queda pegado en el paso de login. Base es la unica cadena.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: {
          theme: "dark",
          accentColor: "#ec1b69",
          logo: "/logo.png",
          landingHeader: "PerkOS",
          showWalletLoginFirst: false
        }
      }}
    >
      <QueryClientProvider client={query}>
        <WagmiProvider config={wagmi}>
          <Bridge>{children}</Bridge>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

// Codigos de Privy -> texto para el usuario. Cerrar el modal no es un error.
function humanPrivyError(code: string): string {
  switch (code) {
    case "exited_auth_flow":
    case "user_exited_auth_flow":
      return "";
    case "invalid_credentials":
      return "That code didn't match. Try again.";
    case "allowlist_rejected":
      return "This account isn't on the allowlist yet.";
    case "must_be_authenticated":
      return "Please sign in first.";
    case "unknown_connect_wallet_error":
    case "generic_connect_wallet_error":
      return "Couldn't connect that wallet. Try email or Google.";
    default:
      return `Sign-in failed (${code}).`;
  }
}

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, logout: privyLogout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [error, setError] = useState("");
  // Privy tarda segundos en cerrar la sesion y mientras tanto sigue `authenticated`.
  // En ese lapso la app ya muestra la bienvenida: `connected` debe leer false y un
  // login() no debe dispararse hasta que el cierre termine (si no, Privy lo ignora y
  // el usuario tenia que ir atras y adelante para que el modal saliera bien).
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutRef = useRef<Promise<void> | null>(null);
  const logout = useCallback(() => {
    if (logoutRef.current) return logoutRef.current;
    setLoggingOut(true);
    flog("info", "privy: logout started");
    const p = privyLogout()
      .then(() => flog("info", "privy: session closed"))
      .catch((e: unknown) => flog("warn", `privy: logout failed: ${(e as Error).message}`))
      .finally(() => { logoutRef.current = null; setLoggingOut(false); });
    logoutRef.current = p;
    return p;
  }, [privyLogout]);
  // Sin onError un login fallido cierra el modal sin decir nada y la app parece colgada.
  const { login } = useLogin({
    onComplete: () => setError(""),
    onError: (code) => setError(humanPrivyError(String(code)))
  });
  const openLogin = useCallback(async () => {
    setError("");
    if (logoutRef.current) await logoutRef.current;
    if (authenticated && !logoutRef.current) {
      // Sesion vieja todavia viva: cerrarla primero, si no login() no abre nada.
      flog("info", "privy: stale session before login, closing it first");
      await logout();
    }
    flog("info", "privy: login modal");
    login();
  }, [authenticated, login, logout]);

  // user.wallet es la wallet primaria (embebida o enlazada); wallets[0] cubre
  // las externas que Privy conecta sin enlazar todavia.
  const address = user?.wallet?.address ?? wallets[0]?.address ?? "";
  const { signMessage: privySign } = useSignMessage();
  // Firma para PerkOS (nonce de api.perkos.xyz). Embebida: Privy firma sin
  // modal (uiOptions.showWalletUIs false). Externa (MetaMask/WC): la wallet
  // del usuario pide confirmar, como en PerkOS App y EQLTY.
  const signMessage = async (message: string): Promise<string> => {
    const w = wallets.find((x) => x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
    if (w && !String(w.walletClientType ?? "").startsWith("privy")) return w.sign(message);
    const r = await privySign({ message }, { address: address || undefined, uiOptions: { showWalletUIs: false } });
    return r.signature;
  };

  // Transaccion (approve/swap del draft) con la wallet activa: cambia a la
  // cadena pedida y manda eth_sendTransaction por el provider EIP-1193 de
  // Privy. Con MetaMask por WalletConnect la confirmacion sale en el celular.
  const sendTransaction = async (tx: { to: `0x${string}`; data: `0x${string}`; value?: `0x${string}`; chainId: number }): Promise<`0x${string}`> => {
    // Solo la wallet de la sesion: firmar con otra que Privy tenga a mano pagaria a otra direccion.
    const w = wallets.find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (!w) throw new Error("wallet_link_lost");
    // Con WalletConnect cada peticion viaja al celular: si la wallet ya esta en
    // la cadena, no se pide el cambio (era una primera peticion muda que podia
    // colgarse antes de llegar a la transaccion).
    const onChain = String((w as { chainId?: string }).chainId ?? "").endsWith(`:${tx.chainId}`);
    flog("info", `wallet tx: ${String(w.walletClientType ?? "?")} via ${String((w as { connectorType?: string }).connectorType ?? "?")} · chain ${String((w as { chainId?: string }).chainId ?? "?")}${onChain ? "" : ` -> switching to ${tx.chainId}`}`);
    if (!onChain) { await w.switchChain(tx.chainId); flog("info", "wallet tx: chain switched"); }
    const provider = await w.getEthereumProvider();
    flog("info", "wallet tx: request sent to the wallet, waiting for confirmation");
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: w.address, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }]
    });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet returned no transaction hash");
    return hash as `0x${string}`;
  };

  // Donde firma la persona: con WalletConnect (login por QR) la peticion llega a la
  // app de la wallet en el celular y solo se ve si esa app esta abierta.
  const active = wallets.find((x) => x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
  const clientType = String(active?.walletClientType ?? "");
  const connector = String((active as { connectorType?: string } | undefined)?.connectorType ?? "");
  const signWhere: Wallet["signWhere"] = !active ? "" : clientType.startsWith("privy") ? "embedded" : /wallet_?connect/i.test(connector) || /wallet_?connect/i.test(clientType) ? "phone" : "extension";
  const walletName = String((active as { meta?: { name?: string } } | undefined)?.meta?.name ?? "").replace(/^WalletConnect$/i, "");
  // La sesion puede estar viva sin wallet enlazada a esta ventana (WalletConnect caido).
  const canSign = Boolean(authenticated && !loggingOut && address && wallets.some((x) => x.address.toLowerCase() === address.toLowerCase()));
  // Reenlazar = volver a entrar. El modal "connect wallet" de Privy no ofrece el QR
  // de WalletConnect dentro de Electron (solo Coinbase Wallet), y forzar una lista de
  // wallets en la config le quito WalletConnect tambien al login. El camino que si
  // funciona es el login normal: More options > WalletConnect.
  const reconnect = () => { setError(""); void logout().then(() => login()).catch(() => login()); };

  const value = useMemo<Wallet>(
    () => ({
      enabled: true,
      loaded: ready,
      connected: Boolean(authenticated && address && !loggingOut),
      proven: Boolean(authenticated && address && !loggingOut),
      address: loggingOut ? "" : address,
      providers: [],
      awaitingOtp: false,
      busy: !ready || (authenticated && !walletsReady) || loggingOut,
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
      reconnect
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, authenticated, error, login, logout, openLogin, loggingOut, ready, walletsReady, wallets, signWhere, walletName, canSign]
  );
  return <WalletContext value={value}>{children}</WalletContext>;
}
