// Copies pages from a downloaded `page-snapshots` CI artifact into
// test/fixtures, stripping what the parser never reads (scripts, styles, the
// site menu, cookie banner, ads) so the fixtures stay small enough to commit.
//
//   node scripts/update-fixtures.js ~/Downloads/page-snapshots/*.html
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const FIXTURES_DIR = path.join(__dirname, "..", "test", "fixtures");
const UNUSED = [
  "script",
  "style",
  "svg",
  "noscript",
  "link",
  "iframe",
  "#navbar",
  "#navbar-top",
  "#cl-consent",
  "#fb-root",
  '[class*="__lxG__"]',
  "footer",
  ".footerp320",
].join(", ");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/update-fixtures.js <snapshot.html>...");
  process.exit(1);
}

for (const file of files) {
  const $ = cheerio.load(fs.readFileSync(file, "utf8"));
  $(UNUSED).remove();
  $("*")
    .contents()
    .filter((index, node) => node.type === "comment")
    .remove();
  const html = $.html()
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n");
  const out = path.join(FIXTURES_DIR, path.basename(file));
  fs.writeFileSync(out, html);
  console.log(`${out} (${Math.round(html.length / 1024)}KB)`);
}
