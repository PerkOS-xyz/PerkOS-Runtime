// electron-builder afterPack: runs once the shell is packed, before the DMG.
// 1. Puts the desk web server into the bundle (electron-builder's matcher
//    drops node_modules from extraResources, and the standalone server needs
//    them whole).
// 2. Signs the whole app by certificate SHA-1 (PERKOS_SIGN_HASH): the keychain
//    can hold several Developer ID certificates with the same name, which makes
//    signing by name ambiguous. electron-builder's own signing is off
//    (mac.identity=null). Without a hash the app is sealed ad-hoc.
// 3. Notarizes and staples the app when Apple credentials are present, so the
//    app inside the DMG validates offline too.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");
const ORT = "node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64";
const ENTITLEMENTS = path.join(__dirname, "entitlements.mac.plist");

function sh(cmd, args, opts = {}) { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], ...opts }).toString(); }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) { if (!fs.existsSync(p)) throw new Error(`broken symlink: ${p}`); continue; }
    if (e.isDirectory()) walk(p, out);
    else if (/\.(node|dylib)$/.test(e.name)) out.push(p);
  }
  return out;
}

function notaryArgs() {
  const e = process.env;
  if (e.APPLE_KEYCHAIN_PROFILE) return ["--keychain-profile", e.APPLE_KEYCHAIN_PROFILE, ...(e.APPLE_KEYCHAIN ? ["--keychain", e.APPLE_KEYCHAIN] : [])];
  if (e.APPLE_ID && e.APPLE_APP_SPECIFIC_PASSWORD && e.APPLE_TEAM_ID) return ["--apple-id", e.APPLE_ID, "--password", e.APPLE_APP_SPECIFIC_PASSWORD, "--team-id", e.APPLE_TEAM_ID];
  return null;
}
exports.notaryArgs = notaryArgs;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const res = path.join(app, "Contents", "Resources", "web");

  fs.rmSync(res, { recursive: true, force: true });
  fs.mkdirSync(path.join(res, ".next"), { recursive: true });
  const ex = ["--exclude", ".env*", "--exclude", "*.log", "--exclude", "scripts/", "--exclude", "tsconfig*", "--exclude", "next-env.d.ts"];
  sh("rsync", ["-a", ...ex, path.join(WEB, ".next", "standalone") + "/", res + "/"]);
  sh("rsync", ["-a", path.join(WEB, ".next", "static") + "/", path.join(res, ".next", "static") + "/"]);
  sh("rsync", ["-a", path.join(WEB, "public") + "/", path.join(res, "public") + "/"]);
  // onnxruntime opens its dylib with dlopen; Next's tracer only sees the .node.
  fs.mkdirSync(path.join(res, ORT), { recursive: true });
  for (const f of fs.readdirSync(path.join(WEB, ORT))) fs.copyFileSync(path.join(WEB, ORT, f), path.join(res, ORT, f));

  const hash = process.env.PERKOS_SIGN_HASH?.trim();
  const bins = walk(res);
  if (hash) {
    // Inner native binaries first (outside the standard bundle layout, so
    // --deep would not reach them), then the app: frameworks, helpers, main.
    for (const b of bins) sh("codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", hash, b]);
    sh("codesign", ["--force", "--deep", "--options", "runtime", "--timestamp", "--entitlements", ENTITLEMENTS, "--sign", hash, app]);
  } else {
    for (const b of bins) sh("codesign", ["--force", "--sign", "-", b]);
    sh("codesign", ["--force", "--deep", "--sign", "-", app]);
  }
  sh("codesign", ["--verify", "--deep", "--strict", app]);
  console.log(`  • desk server in bundle  binaries=${bins.length} signed=${hash ? "developer-id" : "ad-hoc"}`);

  const notary = hash ? notaryArgs() : null;
  if (notary) {
    const zip = path.join(os.tmpdir(), `perkos-notarize-${Date.now()}.zip`);
    sh("ditto", ["-c", "-k", "--keepParent", app, zip]);
    console.log("  • notarizing app (this can take a few minutes)");
    sh("xcrun", ["notarytool", "submit", zip, "--wait", ...notary], { stdio: ["ignore", "inherit", "inherit"] });
    sh("xcrun", ["stapler", "staple", app]);
    fs.rmSync(zip, { force: true });
    console.log("  • app notarized and stapled");
  }
};
