import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Carpeta de la persona: ajustes, sesion, vault, cache, logs, modelos. Nunca
// dentro del repo ni del bundle. PERKOS_HOME la mueve (pruebas aisladas).
// Hasta 0.2.0 era ~/.perkos-floor: se migra una vez renombrando la carpeta
// entera, solo si la nueva aun no existe. El shell (apps/desktop) hace lo mismo
// antes de arrancar el servidor, asi cualquiera de los dos que llegue primero.
const LEGACY_HOME = join(homedir(), ".perkos-floor");
export const HOME_DIR = process.env.PERKOS_HOME?.trim() || join(homedir(), ".perkos-xyz");
try {
  if (!process.env.PERKOS_HOME?.trim() && !existsSync(HOME_DIR) && existsSync(LEGACY_HOME)) renameSync(LEGACY_HOME, HOME_DIR);
} catch {}
export const homePath = (...parts: string[]) => join(HOME_DIR, ...parts);
