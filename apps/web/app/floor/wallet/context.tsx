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
  signMessage: async () => { throw new Error("wallet disabled"); }
};

const Ctx = createContext<Wallet>(disabledWallet);

export function WalletContext({ value, children }: { value: Wallet; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  return useContext(Ctx);
}
