const { app, BrowserWindow, shell, session, powerSaveBlocker } = require("electron");
app.setName("PerkOS");

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const mac = process.platform === "darwin";
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;
const IN_APP_HOSTS = [
  /(^|\.)privy\.io$/,
  /(^|\.)walletconnect\.(com|org)$/,
  /(^|\.)reown\.com$/,
  /(^|\.)metamask\.io$/,
  /^metamask\.app\.link$/,
  /(^|\.)coinbase\.com$/,
  /^accounts\.google\.com$/,
  /(^|\.)apple\.com$/,
  /(^|\.)x\.com$/,
  /^twitter\.com$/
];
// Carpeta de la persona. Hasta 0.2.0 era ~/.perkos-floor: se migra una vez
// (renombre completo) si la nueva no existe; el servidor hace la misma
// comprobacion (apps/web/app/lib/home.ts). PERKOS_HOME la mueve para pruebas.
const LEGACY_HOME = path.join(os.homedir(), ".perkos-floor");
const HOME_DIR = process.env.PERKOS_HOME?.trim() || path.join(os.homedir(), ".perkos-xyz");
try { if (!process.env.PERKOS_HOME?.trim() && !fs.existsSync(HOME_DIR) && fs.existsSync(LEGACY_HOME)) fs.renameSync(LEGACY_HOME, HOME_DIR); } catch {}
// Version for Settings › About: package.json version + git short SHA. The
// packaged app gets the SHA injected by electron-builder (extraMetadata.buildSha).
const APP_VERSION = app.getVersion();
const APP_BUILD = (() => {
  try { const sha = require("./package.json").buildSha; if (sha) return String(sha); } catch {}
  try { return require("child_process").execSync("git rev-parse --short HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
})();
let child = null;
// Token por arranque para la API local: el servidor lo exige (PERKOS_API_TOKEN),
// la ventana lo recibe en la URL de carga y lo manda en x-perkos-token, y el
// bridge de voz lo lee de ~/.perkos-xyz/api-token (0600). Ver apps/web/app/lib/guard.ts.
const API_TOKEN = crypto.randomBytes(24).toString("hex");

// Pruebas: PERKOS_USER_DATA aisla el perfil de Chromium (sesion Privy, storage)
// para abrir el .app junto a la version de desarrollo sin pisar su perfil.
if (process.env.PERKOS_USER_DATA) app.setPath("userData", process.env.PERKOS_USER_DATA);
// El perfil se llamaba "PerkOS Floor" hasta 0.2.0: se renombra una vez para
// conservar la sesion de Privy y el storage.
try {
  const appData = app.getPath("appData");
  const oldProfile = path.join(appData, "PerkOS Floor");
  const newProfile = path.join(appData, app.getName());
  if (!process.env.PERKOS_USER_DATA && !fs.existsSync(newProfile) && fs.existsSync(oldProfile)) fs.renameSync(oldProfile, newProfile);
} catch {}

// Floor.app empaquetado: las claves del servidor (BANKR_API_KEY, BASE_RPC_URL,
// KNOWLEDGE_*) no viajan dentro del bundle. Se leen de ~/.perkos-xyz/env,
// formato KEY=VALUE como apps/web/.env.local. En desarrollo Next lee .env.local.
function homeEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(HOME_DIR, "env"), "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch {}
  return out;
}

function takePort(want = 3847) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.unref();
    s.on("error", () => {
      const t = net.createServer();
      t.unref();
      t.listen(0, "127.0.0.1", () => {
        const p = t.address().port;
        t.close(() => ok(p));
      });
    });
    s.listen(want, "127.0.0.1", () => {
      s.close(() => ok(want));
    });
  });
}

function ping(target) {
  return new Promise((ok, no) => {
    const req = http.get(target, (res) => {
      res.resume();
      ok();
    });
    req.on("error", no);
    req.setTimeout(800, () => {
      req.destroy();
      no(new Error("timeout"));
    });
  });
}

async function waitFor(target, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      await ping(target);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("down");
}

function startWeb(port) {
  if (app.isPackaged) {
    // Servidor autocontenido de `next build` (output: standalone), copiado a
    // Contents/Resources/web por electron-builder. Corre con el Node del propio
    // Electron (ELECTRON_RUN_AS_NODE), asi el .app no depende de un Node instalado.
    const web = path.join(process.resourcesPath, "web");
    const logs = path.join(HOME_DIR, "logs");
    fs.mkdirSync(logs, { recursive: true });
    const log = fs.createWriteStream(path.join(logs, "perkos-app.log"), { flags: "a", mode: 0o600 });
    log.write(`\n[${new Date().toISOString()}] PerkOS.app ${app.getVersion()} · port ${port}\n`);
    child = spawn(process.execPath, [path.join(web, "server.js")], {
      cwd: web,
      env: {
        ...process.env,
        ...homeEnv(),
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PERKOS_APP_VERSION: APP_VERSION,
        PERKOS_APP_BUILD: APP_BUILD,
        PERKOS_API_TOKEN: API_TOKEN,
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        PERKOS_DEBUG_LOG: path.join(logs, "perkos-debug.log")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    return;
  }
  const web = path.join(__dirname, "../web");
  child = spawn("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: web,
    env: { ...process.env, PERKOS_APP_VERSION: APP_VERSION, PERKOS_APP_BUILD: APP_BUILD, PERKOS_API_TOKEN: API_TOKEN },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.on("data", (b) => process.stdout.write(b));
  child.stderr?.on("data", (b) => process.stderr.write(b));
}

async function url() {
  if (process.env.PERKOS_URL) return process.env.PERKOS_URL;
  const port = await takePort();
  startWeb(port);
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(HOME_DIR, "api-token"), API_TOKEN, { mode: 0o600 });
  } catch {}
  // Debe quedarse en 127.0.0.1 (o localhost). Privy lee window.location.hostname
  // y rechaza cualquier otro nombre sobre http con "Embedded wallet is only
  // available over HTTPS", asi que un alias DNS via host-rules no sirve.
  return `http://127.0.0.1:${port}`;
}

async function create() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "PerkOS",
    // Linux / Windows toman el icono de la ventana; macOS usa el del Dock (abajo).
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#00000000",
    transparent: true,
    hasShadow: true,
    vibrancy: mac ? "hud" : undefined,
    visualEffectState: mac ? "active" : undefined,
    titleBarStyle: mac ? "hiddenInset" : undefined,
    trafficLightPosition: mac ? { x: 16, y: 16 } : undefined,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Sin esto Chromium frena los timers a 1/s cuando la ventana pierde el
      // foco, y el detector de silencio del microfono (100 ms) deja de cortar
      // a tiempo. La voz tiene que seguir viva aunque mires otra app.
      backgroundThrottling: false
    }
  });
  win.setBackgroundColor("#00000000");
  // Solo el login de xAI (auth.x.ai) sale al browser del sistema, donde el
  // usuario tiene su sesion de X/Grok. Todo lo demas (MetaMask, WalletConnect,
  // Privy) sigue abriendo como antes: mandarlo afuera rompia el QR de MetaMask.
  // La ventana principal nunca sale del servidor local: cualquier enlace sin
  // target que apunte afuera se abre en el browser del sistema.
  win.webContents.on("will-navigate", (e, url) => {
    if (LOCAL_URL.test(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  // Ventanas nuevas (target=_blank, window.open): solo los popups de wallet y
  // de login (Privy, WalletConnect/Reown, MetaMask, Coinbase, Google/Apple/X)
  // se abren dentro del app; todo lo demas (noticias de Grok, basescan, xAI,
  // pay.perkos.xyz, 1Claw) va al browser del sistema con la sesion de la persona.
  // file: y similares se niegan.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === "file:" || u.protocol === "javascript:") return { action: "deny" };
      // Compartir en X va al browser del sistema, donde la persona tiene su sesion
      // (dentro del app x.com solo se abre para el login con X).
      const shareIntent = /(^|\.)(x|twitter)\.com$/.test(u.hostname) && /^\/(intent|share)\b/.test(u.pathname);
      if (!shareIntent && /^https?:$/.test(u.protocol) && IN_APP_HOSTS.some((re) => re.test(u.hostname))) return { action: "allow" };
      process.stderr.write(`window-open: ${u.hostname || u.protocol} -> system browser\n`);
      shell.openExternal(url);
    } catch {}
    return { action: "deny" };
  });
  try {
    const target = await url();
    await waitFor(target);
    await win.loadURL(`${target}/?t=${API_TOKEN}`);
  } catch {
    await win.loadFile(path.join(__dirname, "waiting.html"));
  }
}

app.whenReady().then(() => {
  // En desarrollo Electron muestra su propio icono en el Dock; el .app
  // empaquetado usara el .icns del bundle. Hasta entonces, el logo de PerkOS.
  if (mac && app.dock && !app.isPackaged) {
    try { app.dock.setIcon(path.join(__dirname, "icon.png")); } catch {}
  }
  // Microfono para el composer, y escritura al portapapeles para los botones de
  // copiar: Electron niega "media" si no hay handler, y la comprobacion
  // sincrona negaba clipboard-sanitized-write, asi que navigator.clipboard
  // fallaba en silencio y el boton decia "Copied" sin haber copiado nada.
  const allowed = new Set(["media", "clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  // Floor escucha y habla: que macOS no suspenda la app mientras esta abierta.
  // (Sin preload no hay IPC desde el renderer; se activa para toda la sesion.)
  powerSaveBlocker.start("prevent-app-suspension");
  return create();
});
app.on("before-quit", () => {
  if (child && !child.killed) child.kill();
});
app.on("window-all-closed", () => app.quit());
