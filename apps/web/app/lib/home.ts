import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Carpeta de la persona: ajustes, sesion, vault, cache, logs, modelos. Nunca
// dentro del repo ni del bundle. PERKOS_HOME la mueve (pruebas aisladas).
// Hasta 0.2.0 era ~/.perkos-floor: se migra una vez renombrando la carpeta
// entera, solo si la nueva aun no existe. La migracion es perezosa (primer
// acceso a disco), no al importar el modulo: `next build` importa estas
// librerias al prerenderizar y no debe tocar la carpeta de nadie. El shell
// (apps/desktop) hace la misma comprobacion antes de arrancar el servidor.
const LEGACY_HOME = join(homedir(), ".perkos-floor");
export const HOME_DIR = process.env.PERKOS_HOME?.trim() || join(homedir(), ".perkos-xyz");
let checked = false;
export function ensureHome(): string {
  if (!checked) {
    checked = true;
    try {
      if (!process.env.PERKOS_HOME?.trim() && !existsSync(HOME_DIR) && existsSync(LEGACY_HOME)) renameSync(LEGACY_HOME, HOME_DIR);
    } catch {}
  }
  return HOME_DIR;
}
export const homePath = (...parts: string[]) => join(ensureHome(), ...parts);
