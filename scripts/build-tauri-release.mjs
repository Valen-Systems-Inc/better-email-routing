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
const entitlementsPath = path.join(projectRoot, "src-tauri", "entitlements.plist");
const stageDir = path.join(tempRoot, "dmg-stage");
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY || "-";
const isDeveloperIdSigned = signingIdentity !== "-";
const notaryProfile = process.env.APPLE_NOTARY_PROFILE || process.env.NOTARYTOOL_PROFILE || "";
const isNotarizedBuild = Boolean(notaryProfile);

run("npx", ["tauri", "build", "--ignore-version-mismatches", "--bundles", "app"], { env: unsignedTauriBuildEnv() });

if (!fs.existsSync(appPath)) {
  throw new Error(`Tauri app bundle was not created: ${appPath}`);
}

try {
  run("ditto", [appPath, signedAppPath]);
  scrubExtendedAttributes(signedAppPath);
  signApp(signedAppPath);
  verifySignature(signedAppPath);
  createDmg();
  notarizeDmg();
  writeManifests();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`Built ${describeBuildKind()} macOS DMG: ${path.relative(projectRoot, dmgPath)}`);

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options
  });
}

function unsignedTauriBuildEnv() {
  const env = { ...process.env };
  env.FORCE_SIDECAR_BUILD = "1";

  // The Tauri bundler signs before we can scrub File Provider/Finder metadata.
  // Build the intermediate .app unsigned, then sign the cleaned copy below.
  delete env.APPLE_SIGNING_IDENTITY;
  delete env.APPLE_CERTIFICATE;
  delete env.APPLE_CERTIFICATE_PASSWORD;

  return env;
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
  signNodeSidecar(targetPath);

  const args = ["--force", "--sign", signingIdentity];

  if (isDeveloperIdSigned) {
    args.push("--options", "runtime", "--timestamp");
  }

  args.push(targetPath);
  run("codesign", args);
}

function signNodeSidecar(targetPath) {
  const sidecarPath = path.join(targetPath, "Contents", "MacOS", "core-mail-server");
  if (!fs.existsSync(sidecarPath)) return;

  const args = ["--force", "--sign", signingIdentity];

  if (isDeveloperIdSigned) {
    args.push("--options", "runtime", "--timestamp", "--entitlements", entitlementsPath);
  }

  args.push(sidecarPath);
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

  if (assessment.status !== 0 && !isDeveloperIdSigned) {
    console.warn(`spctl rejected this internal build, which is expected without Developer ID notarization:\n${combined}`);
  }
}

function notarizeDmg() {
  if (!isNotarizedBuild) return;

  if (!isDeveloperIdSigned) {
    throw new Error("Notarization requires APPLE_SIGNING_IDENTITY to be set to a Developer ID Application certificate.");
  }

  run("xcrun", ["notarytool", "submit", dmgPath, "--keychain-profile", notaryProfile, "--wait"]);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "validate", dmgPath]);
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
      isNotarizedBuild
        ? "Builds the Mac installer from a cleaned, Developer ID signed and notarized Tauri app bundle."
        : isDeveloperIdSigned
        ? "Builds the Mac installer from a cleaned, Developer ID signed Tauri app bundle."
        : "Builds the Mac installer from a cleaned, ad-hoc-signed Tauri app bundle for internal distribution.",
      "Signs the bundled Core Mail server with the JIT entitlement required by Node/V8 under hardened runtime.",
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

function describeBuildKind() {
  if (isNotarizedBuild) return "Developer ID signed and notarized";
  if (isDeveloperIdSigned) return "Developer ID signed";
  return "internal";
}
