const getData = require("./get-data");
const generateWebpage = require("./generate-webpage");

const url = "https://www.cinefil.com/seances-cinema/limoux-11";

async function main() {
  const data = await getData(url);
  const webpage = await generateWebpage(url, data);
  console.log(webpage);
}

main();
