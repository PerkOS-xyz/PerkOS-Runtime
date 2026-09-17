"use client";

import { createContext, useContext } from "react";

export type WalletProviderInfo = { key: string; name: string };

export type Wallet = {
  enabled: boolean;
  loaded: boolean;
  connected: boolean;
  address: string;
  providers: WalletProviderInfo[];
  awaitingOtp: boolean;
  busy: boolean;
  error: string;
  qr: string;
  open: (key?: string) => void;
  sendEmail: (email: string) => void;
  verifyOtp: (code: string) => void;
  startQr: () => void;
  prove: () => void;
  proven: boolean;
  forget: () => void;
  logout: () => void;
  // personal_sign con la wallet activa (embebida o externa). Para la sesion PerkOS.
  signMessage: (message: string) => Promise<string>;
  // eth_sendTransaction con la wallet activa en la cadena pedida (Base para el
  // swap del Trader). Externa: MetaMask pide confirmar. Devuelve el hash.
  sendTransaction: (tx: { to: `0x${string}`; data: `0x${string}`; value?: `0x${string}`; chainId: number }) => Promise<`0x${string}`>;
  /** Donde va a aparecer la confirmacion: "phone" (WalletConnect: la app de la wallet en el
   *  celular, que tiene que estar abierta), "extension" (wallet del navegador) o "embedded" (Privy). */
  signWhere: "phone" | "extension" | "embedded" | "";
  /** Nombre de la wallet activa cuando Privy lo sabe ("MetaMask", "Rainbow"). */
  walletName: string;
};

export const disabledWallet: Wallet = {
  enabled: false,
  loaded: true,
  connected: false,
  address: "",
  providers: [],
  awaitingOtp: false,
  busy: false,
  error: "",
  qr: "",
  open: () => undefined,
  sendEmail: () => undefined,
  verifyOtp: () => undefined,
  startQr: () => undefined,
  prove: () => undefined,
  proven: false,
  forget: () => undefined,
  logout: () => undefined,
  signMessage: async () => { throw new Error("wallet disabled"); },
  sendTransaction: async () => { throw new Error("wallet disabled"); },
  signWhere: "",
  walletName: ""
};

const Ctx = createContext<Wallet>(disabledWallet);

export function WalletContext({ value, children }: { value: Wallet; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  return useContext(Ctx);
}
