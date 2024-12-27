const Page = (...content) => {
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>VO films near Limoux</title>
  <link rel="stylesheet" href="css/styles.css?v=1.0">
</head>
<body>
${content.join("\n")}
</body>
</html>
`;
};

const Showing = ({ id, title, date, time }, url) => `
    <a href="${url}#${id}">${title}</a> @ ${date} ${time}
`;

const Venue = ({
  id,
  name,
  location,
  url,
  homepage,
  distance,
  showings,
}) => `<div>
    <h2 id="${id}">${name}, in ${location} (${distance}km away)</h2>
    <div>
        <a href="${url}">Cinefil</a>
        ${homepage ? ` | <a href="${homepage}">Homepage</a>` : ``}
    </div>
    <ul>
        <li>${showings.map((showing) => Showing(showing, url)).join("</li><li>")}</li>
    </ul>
</div>`;

const Heading = (...content) => `<h1>${content.join("\n")}</h1>`;
const Paragraph = (...content) => `<p>${content.join("\n")}</p>`;

async function main(url, data) {
  return Page(
    Heading("Version Originale films near Limoux"),
    Paragraph(`Find below information sourced from ${url}`),
    `<hr />`,
    ...data.map(Venue),
  );
}

module.exports = main;
