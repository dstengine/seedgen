// Builds dist/: one bundled script, the page, its icons, a manifest, a
// service worker, robots.txt and the sitemap. Asset URLs are relative, so
// the same dist serves from any path; canonical URLs name seedgen.uk.
import { build } from "esbuild";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const src = (f) => new URL(`./src/${f}`, import.meta.url);
const dist = (f = "") => new URL(`./dist/${f}`, import.meta.url);

const SITE = "https://seedgen.uk/";

rmSync(dist(), { recursive: true, force: true });
mkdirSync(dist());
cpSync(new URL("./public/", import.meta.url), dist(), { recursive: true });

await build({
  entryPoints: ["src/app.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  platform: "browser",
  outfile: "dist/app.js",
  legalComments: "none",
  logLevel: "warning",
});
cpSync(src("style.css"), dist("style.css"));
cpSync(src("icon.svg"), dist("icon.svg"));

const svg = readFileSync(src("icon.svg"));
for (const size of [180, 192, 512]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(dist(`icon-${size}.png`).pathname);
}
// Maskable: the mark inside the safe circle on a full-bleed square.
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#6B24C4" } })
  .composite([{ input: await sharp(svg, { density: 300 }).resize(380, 380).png().toBuffer(), gravity: "center" }])
  .png()
  .toFile(dist("icon-maskable.png").pathname);
// Share card, 1200×630.
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#120A1F"/>
  <text x="80" y="250" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="800" fill="#F1ECF8">Seed phrase generator</text>
  <text x="80" y="340" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="#B98BFF">Solana · Ethereum · Bitcoin · Tron · TON · Monero</text>
  <text x="80" y="420" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#A79BBB">One tap, 24 words, six addresses — offline in your browser</text>
</svg>`;
await sharp(Buffer.from(card)).png().toFile(dist("share.png").pathname);

writeFileSync(dist("manifest.webmanifest"), JSON.stringify({
  name: "Seedgen — seed phrase generator",
  short_name: "Seedgen",
  description: "Seed phrase generator: a 12- or 24-word phrase and its Solana, Ethereum, Bitcoin, Tron, TON and Monero addresses, Trust Wallet's included, offline.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait",
  background_color: "#120A1F",
  theme_color: "#6B24C4",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
}, null, 2));

// The version is the hash of what ships, so an unchanged build keeps its
// cache and a changed one replaces it.
const hash = createHash("sha256");
for (const f of ["app.js", "style.css", "manifest.webmanifest", "icon.svg"]) hash.update(readFileSync(dist(f)));
hash.update(readFileSync(src("index.html")));
const version = hash.digest("hex").slice(0, 10);

writeFileSync(dist("index.html"), readFileSync(src("index.html"), "utf8").replaceAll("__VERSION__", version));
const files = ["./", `app.js?v=${version}`, `style.css?v=${version}`, "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable.png"];
writeFileSync(dist("sw.js"), readFileSync(src("sw.js"), "utf8").replace("__VERSION__", `seedgen-${version}`).replace("__FILES__", JSON.stringify(files)));

// The page is dated by the last commit that changed what it shows (src/),
// not by the build: a date that is always "now" is worse than none. Vercel
// gets the upload without .git, so the date is kept in src/updated.txt,
// which every local build refreshes from git and the deploy carries along.
const stampFile = src("updated.txt");
let updated;
try {
  updated = execFileSync("git", ["log", "-1", "--format=%cI", "--", "src/", ":!src/updated.txt"], { encoding: "utf8" }).trim();
} catch {}
if (updated) writeFileSync(stampFile, updated + "\n");
else if (existsSync(stampFile)) updated = readFileSync(stampFile, "utf8").trim();
writeFileSync(dist("robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
writeFileSync(dist("sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>${updated ? `\n    <lastmod>${updated}</lastmod>` : ""}
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);

const kb = (f) => (readFileSync(dist(f)).length / 1024).toFixed(1);
console.log(`dist/ built, version ${version}; app.js ${kb("app.js")} KB, style.css ${kb("style.css")} KB`);
