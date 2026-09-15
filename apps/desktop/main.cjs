const { app, BrowserWindow, shell, session, powerSaveBlocker } = require("electron");
app.setName("PerkOS Floor");

const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const mac = process.platform === "darwin";
let child = null;

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
  const web = path.join(__dirname, "../web");
  child = spawn("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: web,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.on("data", (b) => process.stdout.write(b));
  child.stderr?.on("data", (b) => process.stderr.write(b));
}

async function url() {
  if (process.env.FLOOR_URL) return process.env.FLOOR_URL;
  const port = await takePort();
  startWeb(port);
  // Debe quedarse en 127.0.0.1 (o localhost). Privy lee window.location.hostname
  // y rechaza cualquier otro nombre sobre http con "Embedded wallet is only
  // available over HTTPS", asi que un alias DNS via host-rules no sirve.
  return `http://127.0.0.1:${port}`;
}

async function create() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "PerkOS Floor",
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const host = new URL(url).hostname;
      // Login de xAI y el portal de pagos (pay.perkos.xyz): ahi el usuario usa
      // su sesion de X/Grok o la wallet del browser. MetaMask/WalletConnect/
      // Privy siguen adentro: mandarlos afuera rompia el QR de MetaMask.
      if (host === "auth.x.ai" || host.endsWith(".x.ai") || host === "pay.perkos.xyz" || host.endsWith(".pay.perkos.xyz")) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {}
    return { action: "allow" };
  });
  try {
    const target = await url();
    await waitFor(target);
    await win.loadURL(target);
  } catch {
    await win.loadFile(path.join(__dirname, "waiting.html"));
  }
}

app.whenReady().then(() => {
  // En desarrollo Electron muestra su propio icono en el Dock; el .app
  // empaquetado usara el .icns del bundle. Hasta entonces, el logo de PerkOS.
  if (mac && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, "icon.png")); } catch {}
  }
  // Microfono para el composer (getUserMedia). Electron niega "media" si no hay handler.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === "media" || permission === "clipboard-read");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  // Floor escucha y habla: que macOS no suspenda la app mientras esta abierta.
  // (Sin preload no hay IPC desde el renderer; se activa para toda la sesion.)
  powerSaveBlocker.start("prevent-app-suspension");
  return create();
});
app.on("before-quit", () => {
  if (child && !child.killed) child.kill();
});
app.on("window-all-closed", () => app.quit());
