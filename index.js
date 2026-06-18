const fs = require("fs/promises");
const path = require("path");
const getData = require("./get-data");
const generateWebpage = require("./generate-webpage");

const url = "https://www.cinefil.com/seances-cinema/limoux-11";
const outputFile = path.join(__dirname, "site", "index.html");

async function main() {
  const data = await getData(url);
  const webpage = await generateWebpage(url, data);
  // Write only after a successful scrape + render, so a failed run leaves the
  // previous good page intact rather than overwriting it with a blank file
  // (which a shell `> index.html` redirect would do by truncating up front).
  await fs.writeFile(outputFile, webpage);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
