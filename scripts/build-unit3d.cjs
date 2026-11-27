const esbuild = require("esbuild");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const outFile = path.join(root, "public/assets/unit3d.bundle.js");
fs.mkdirSync(path.dirname(outFile), { recursive: true });

esbuild
  .build({
    entryPoints: [path.join(root, "src/web/unit3dOverlay.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020"],
    outfile: outFile,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  })
  .then(() => {
    const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log(`[VDN T09] Built public/assets/unit3d.bundle.js (${sizeKb} kB)`);
  })
  .catch((err) => {
    console.error("[VDN T09] Failed to build unit3d.bundle.js:", err);
    process.exit(1);
  });
