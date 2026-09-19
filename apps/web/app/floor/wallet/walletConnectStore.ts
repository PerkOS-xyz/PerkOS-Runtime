import { flog } from "../log";

/** WalletConnect v2 guarda su sesion en localStorage (`wc@2:*`) y en IndexedDB. Al salir,
 *  el conector cierra lo suyo y borra el registro, pero el almacen queda con la referencia: el
 *  primer QR del siguiente login nace atado a ella y no conecta nunca
 *  ("Missing or invalid. Record was recently deleted"), hasta que se cierra y se reabre el
 *  modal, que fuerza un emparejamiento nuevo. Esto lo limpia para que el primer QR ya sirva.
 *  Sobrevive al reinicio de la app, asi que no basta con cerrarla y abrirla. */
export function purgeWalletConnect() {
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith("wc@2:") || k.startsWith("WALLETCONNECT_")) window.localStorage.removeItem(k);
    }
    window.indexedDB?.deleteDatabase("WALLET_CONNECT_V2_INDEXED_DB");
    flog("info", "walletconnect: storage cleared for the next pairing");
  } catch (e) {
    flog("warn", `walletconnect: could not clear storage: ${(e as Error).message}`);
  }
}
