/**
 * Desktop shell: starts the web app's server on 127.0.0.1 and opens it in a window.
 *
 * - A per-launch token is passed to the server (PERKOS_API_TOKEN) and added to
 *   every request the window makes to it (x-perkos-token), so other pages on
 *   the machine cannot call the local API.
 * - Port 3100 is preferred so the origin stays stable (wallet services allow
 *   origins by exact match). Another free port is used if it is taken.
 * - The window stays on the local server; other links open in the system browser,
 *   except wallet and sign-in popups.
 */

const { app, BrowserWindow, shell, session } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const path = require("path");

app.setName("PerkOS Runtime");

const mac = process.platform === "darwin";
const PREFERRED_PORT = 3100;
const API_TOKEN = crypto.randomBytes(24).toString("hex");
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;
const IN_APP_HOSTS = [
  /(^|\.)dynamicauth\.com$/,
  /(^|\.)dynamic\.xyz$/,
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

let server = null;

function freePort(want) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", () => {
      const any = net.createServer();
      any.unref();
      any.listen(0, "127.0.0.1", () => {
        const port = any.address().port;
        any.close(() => resolve(port));
      });
    });
    probe.listen(want, "127.0.0.1", () => probe.close(() => resolve(want)));
  });
}

function ping(target) {
  return new Promise((resolve, reject) => {
    const req = http.get(target, (res) => {
      res.resume();
      resolve();
    });
    req.on("error", reject);
    req.setTimeout(800, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function waitFor(target, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      await ping(target);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("server did not start");
}

function startServer(port) {
  const web = path.join(__dirname, "../web");
  // Next runs on Electron's own Node instead of npx, which fails on Windows
  // without a shell. Same command on macOS, Windows and Linux.
  const nextBin = require.resolve("next/dist/bin/next", { paths: [web] });
  server = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: web,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PERKOS_API_TOKEN: API_TOKEN },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout?.on("data", (b) => process.stdout.write(b));
  server.stderr?.on("data", (b) => process.stderr.write(b));
}

async function create() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: "PerkOS Runtime",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#03040a",
    titleBarStyle: mac ? "hiddenInset" : undefined,
    trafficLightPosition: mac ? { x: 16, y: 16 } : undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  win.webContents.on("will-navigate", (e, url) => {
    if (LOCAL_URL.test(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (/^https?:$/.test(u.protocol) && IN_APP_HOSTS.some((re) => re.test(u.hostname))) return { action: "allow" };
      if (/^https?:$/.test(u.protocol)) shell.openExternal(url);
    } catch {}
    return { action: "deny" };
  });

  try {
    const target = process.env.PERKOS_URL || (await launch());
    await waitFor(target);
    await win.loadURL(target);
  } catch {
    await win.loadFile(path.join(__dirname, "waiting.html"));
  }
}

async function launch() {
  const port = await freePort(PREFERRED_PORT);
  if (port !== PREFERRED_PORT) process.stderr.write(`Port ${PREFERRED_PORT} is taken, using ${port}\n`);
  startServer(port);
  const origin = `http://127.0.0.1:${port}`;
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "x-perkos-token": API_TOKEN } });
  });
  return origin;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    if (mac && app.dock && !app.isPackaged) {
      try {
        app.dock.setIcon(path.join(__dirname, "icon.png"));
      } catch {}
    }
    // Microphone for voice conversations with Sparky; clipboard for copy buttons.
    const allowed = new Set(["media", "clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    return create();
  });
}

/** Stops the server and the processes it started (Windows needs the whole tree). */
function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}

app.on("before-quit", stopServer);
app.on("window-all-closed", () => app.quit());
