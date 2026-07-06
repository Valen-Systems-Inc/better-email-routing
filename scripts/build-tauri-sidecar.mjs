import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const binariesDir = path.join(projectRoot, "src-tauri", "binaries");
const extension = process.platform === "win32" ? ".exe" : "";
const targetTriple = getTargetTriple();
const pkgTarget = getPkgTarget();
const outputPath = path.join(binariesDir, `core-mail-server-${targetTriple}${extension}`);

fs.mkdirSync(binariesDir, { recursive: true });

execFileSync(
  "npx",
  [
    "pkg",
    "server.js",
    "--targets",
    pkgTarget,
    "--compress",
    "GZip",
    "--output",
    outputPath
  ],
  { stdio: "inherit" }
);

fs.chmodSync(outputPath, 0o755);
console.log(`Built Tauri sidecar: ${path.relative(projectRoot, outputPath)}`);

function getTargetTriple() {
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  } catch (error) {
    const rustInfo = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const match = rustInfo.match(/^host:\s+(\S+)/m);
    if (!match) {
      throw new Error("Could not determine Rust host target triple.");
    }
    return match[1];
  }
}

function getPkgTarget() {
  const platform = {
    darwin: "macos",
    linux: "linux",
    win32: "win"
  }[process.platform];
  const arch = {
    arm64: "arm64",
    x64: "x64"
  }[process.arch];

  if (!platform || !arch) {
    throw new Error(`Unsupported sidecar build platform: ${process.platform}/${process.arch}`);
  }

  return `node22-${platform}-${arch}`;
}
