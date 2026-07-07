import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const projectRoot = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const appName = "Core Mail";
const runtime = "tauri";
const platform = "macOS Apple Silicon";
const appPath = path.join(projectRoot, "src-tauri", "target", "release", "bundle", "macos", `${appName}.app`);
const bundleRoot = path.join(projectRoot, "src-tauri", "target", "release", "bundle");
const dmgDir = path.join(bundleRoot, "dmg");
const cdnDir = path.join(projectRoot, "release", "cdn", `v${version}`);
const dmgName = `Core-Mail-${version}-aarch64.dmg`;
const dmgPath = path.join(cdnDir, dmgName);
const tauriDmgPath = path.join(dmgDir, `${appName}_${version}_aarch64.dmg`);
const releaseDate = new Date().toISOString();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `core-mail-release-${version}-`));
const signedAppPath = path.join(tempRoot, `${appName}.app`);
const stageDir = path.join(tempRoot, "dmg-stage");

run("npx", ["tauri", "build", "--bundles", "app"]);

if (!fs.existsSync(appPath)) {
  throw new Error(`Tauri app bundle was not created: ${appPath}`);
}

try {
  run("ditto", [appPath, signedAppPath]);
  scrubExtendedAttributes(signedAppPath);
  signApp(signedAppPath);
  verifySignature(signedAppPath);
  createDmg();
  writeManifests();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`Built internal macOS DMG: ${path.relative(projectRoot, dmgPath)}`);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options
  });
}

function output(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options
  }).trim();
}

function scrubExtendedAttributes(targetPath) {
  for (const filePath of walk(targetPath)) {
    for (const attr of [
      "com.apple.FinderInfo",
      "com.apple.ResourceFork",
      "com.apple.quarantine",
      "com.apple.macl",
      "com.apple.fileprovider.fpfs#P"
    ]) {
      spawnSync("xattr", ["-d", attr, filePath], { cwd: projectRoot, stdio: "ignore" });
    }
  }
}

function walk(targetPath) {
  const results = [targetPath];
  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return results;

  for (const entry of fs.readdirSync(targetPath)) {
    results.push(...walk(path.join(targetPath, entry)));
  }

  return results;
}

function signApp(targetPath) {
  const identity = process.env.APPLE_SIGNING_IDENTITY || "-";
  const args = ["--force", "--deep", "--sign", identity];

  if (identity !== "-") {
    args.push("--options", "runtime", "--timestamp");
  }

  args.push(targetPath);
  run("codesign", args);
}

function verifySignature(targetPath) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", targetPath]);

  const assessment = spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=4", targetPath], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  const combined = `${assessment.stdout || ""}${assessment.stderr || ""}`.trim();

  if (assessment.status !== 0 && /code has no resources|resource fork|Finder information/i.test(combined)) {
    throw new Error(`Gatekeeper found a damaged bundle signature:\n${combined}`);
  }

  if (assessment.status !== 0) {
    console.warn(`spctl rejected this internal build, which is expected without Developer ID notarization:\n${combined}`);
  }
}

function createDmg() {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.rmSync(cdnDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.mkdirSync(cdnDir, { recursive: true });
  fs.mkdirSync(dmgDir, { recursive: true });

  run("ditto", [signedAppPath, path.join(stageDir, `${appName}.app`)]);
  fs.symlinkSync("/Applications", path.join(stageDir, "Applications"));
  scrubExtendedAttributes(stageDir);

  fs.rmSync(dmgPath, { force: true });
  run("hdiutil", ["create", "-volname", appName, "-srcfolder", stageDir, "-ov", "-format", "UDZO", dmgPath]);
  fs.copyFileSync(dmgPath, tauriDmgPath);
}

function writeManifests() {
  const sha256 = output("shasum", ["-a", "256", dmgPath]).split(/\s+/)[0];
  const size = fs.statSync(dmgPath).size;
  const baseUrl = "https://downloads.valen-systems.com/better-email-routing";
  const downloadUrl = `${baseUrl}/releases/v${version}/${dmgName}`;
  const manifestUrl = `${baseUrl}/releases/v${version}/manifest.json`;
  const manifest = {
    name: appName,
    version,
    runtime,
    platform,
    releaseDate,
    downloadUrl,
    files: {
      dmg: downloadUrl,
      manifest: manifestUrl
    },
    checksums: {
      dmgSha256: sha256
    },
    sizes: {
      dmg: size
    },
    releaseNotes: [
      "Builds the Mac installer from a cleaned, ad-hoc-signed Tauri app bundle for internal distribution.",
      "Fixes the invalid resource-seal state that caused macOS to report the app as damaged.",
      "Keeps the supplied Core Mail envelope icon and packaged Cloudflare OAuth metadata."
    ],
    source: "https://github.com/Valen-Systems-Inc/better-email-routing"
  };
  const latestMac = [
    `version: ${version}`,
    `runtime: ${runtime}`,
    `path: ${dmgName}`,
    `sha256: ${sha256}`,
    `releaseDate: ${releaseDate}`,
    "files:",
    `  - url: ${downloadUrl}`,
    `    sha256: ${sha256}`,
    `    size: ${size}`,
    ""
  ].join("\n");

  fs.writeFileSync(path.join(cdnDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(projectRoot, "release", "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(projectRoot, "release", "latest-mac-cdn.yml"), latestMac);
  fs.writeFileSync(path.join(projectRoot, "release", "latest-mac.yml"), latestMac);
}
