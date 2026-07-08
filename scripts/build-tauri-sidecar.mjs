import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const binariesDir = path.join(projectRoot, "src-tauri", "binaries");
const buildDir = path.join(projectRoot, "build", "sea");
const extension = process.platform === "win32" ? ".exe" : "";
const targetTriple = getTargetTriple();
const outputPath = path.join(binariesDir, `core-mail-server-${targetTriple}${extension}`);
const entryPath = path.join(buildDir, "core-mail-server-entry.cjs");
const bundlePath = path.join(buildDir, "core-mail-server.bundle.cjs");
const blobPath = path.join(buildDir, "core-mail-server.blob");
const seaConfigPath = path.join(buildDir, "sea-config.json");

fs.mkdirSync(binariesDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

if (fs.existsSync(outputPath) && process.env.FORCE_SIDECAR_BUILD !== "1") {
  fs.chmodSync(outputPath, 0o755);
  console.log(`Reusing existing Tauri sidecar: ${path.relative(projectRoot, outputPath)}`);
  process.exit(0);
}

fs.writeFileSync(
  entryPath,
  [
    "const { startServer } = require('../../server.js');",
    "startServer().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
    ""
  ].join("\n")
);

run("npx", [
  "esbuild",
  entryPath,
  "--bundle",
  "--platform=node",
  "--format=cjs",
  `--outfile=${bundlePath}`
]);

fs.writeFileSync(
  seaConfigPath,
  `${JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false
    },
    null,
    2
  )}\n`
);

run(process.execPath, ["--experimental-sea-config", seaConfigPath]);
fs.copyFileSync(process.execPath, outputPath);

if (process.platform === "darwin") {
  run("codesign", ["--remove-signature", outputPath], { allowFailure: true });
}

const postjectBin = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
const postjectArgs = [
  outputPath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
];

if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}

run(postjectBin, postjectArgs);

if (process.platform === "darwin") {
  run("codesign", ["--force", "--sign", "-", outputPath]);
}

fs.chmodSync(outputPath, 0o755);

console.log(`Built Tauri sidecar: ${path.relative(projectRoot, outputPath)}`);

function run(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env
    });
  } catch (error) {
    if (options.allowFailure) return;
    throw error;
  }
}

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
