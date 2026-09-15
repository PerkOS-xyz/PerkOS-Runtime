"use client";

import { useMemo, useState, type ReactNode } from "react";
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
  transports: { [base.id]: http() }
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [query] = useState(() => new QueryClient());
  if (!appId) {
    return <WalletContext value={disabledWallet}>{children}</WalletContext>;
  }
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
        supportedChains: [base],
        defaultChain: base,
        // Con "off", quien entra por email o Google se autentica pero no recibe
        // ninguna wallet: user.wallet queda vacio, connected nunca pasa a true y
        // el wizard se queda pegado en el paso de login. Base es la unica cadena.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: {
          theme: "dark",
          accentColor: "#ec1b69",
          logo: "/logo.png",
          landingHeader: "PerkOS Floor",
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
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [error, setError] = useState("");
  // Sin onError un login fallido cierra el modal sin decir nada y la app parece colgada.
  const { login } = useLogin({
    onComplete: () => setError(""),
    onError: (code) => setError(humanPrivyError(String(code)))
  });

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
    const w = wallets.find((x) => x.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
    if (!w) throw new Error("No wallet connected");
    await w.switchChain(tx.chainId);
    const provider = await w.getEthereumProvider();
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: w.address, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }]
    });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet returned no transaction hash");
    return hash as `0x${string}`;
  };

  const value = useMemo<Wallet>(
    () => ({
      enabled: true,
      loaded: ready,
      connected: Boolean(authenticated && address),
      proven: Boolean(authenticated && address),
      address,
      providers: [],
      awaitingOtp: false,
      busy: !ready || (authenticated && !walletsReady),
      error,
      qr: "",
      open: () => {
        setError("");
        login();
      },
      sendEmail: () => {
        setError("");
        login();
      },
      verifyOtp: () => undefined,
      startQr: () => {
        setError("");
        login();
      },
      prove: () => undefined,
      forget: () => {
        void logout();
      },
      logout: () => {
        void logout();
      },
      signMessage,
      sendTransaction
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, authenticated, error, login, logout, ready, walletsReady, wallets]
  );
  return <WalletContext value={value}>{children}</WalletContext>;
}
