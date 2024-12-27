const Page = require("./components/page");

const options = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

const Showings = (showings, homepage, url) => {
  if (showings.length === 0) {
    return `
      <div>
        No version originale showings found. Please <a href="${homepage || url}">check the venue homepage</a> for further information and to review all showings.
      </div>
    `;
  }

  let dateGroup = "";
  let output = ``;
  showings.forEach(({ id, title, date, time }) => {
    if (dateGroup !== date) {
      if (dateGroup) output += `</ul>`;
      output += `<h3>${new Date(date).toLocaleDateString("en-GB", options)}</h3>`;
      dateGroup = date;
      output += `<ul>`;
    }
    output += `<li><a href="${url}#${id}">${title}</a> @ ${time}</li>`;
  });
  output += `<ul>`;
  return output;
};

const Venue = ({ id, name, location, url, homepage, distance, showings }) => `
    <div class="venue">
      <h2 id="${id}">
        ${name}, in ${location}
        <span class="venue-details">
          (${distance}km away) &nbsp;
          [<a href="${url}">Cinefil</a>${homepage ? ` | <a href="${homepage}">Homepage</a>` : ``}]
        </span>
      </h2>
      ${Showings(showings, homepage, url)}
    </div>
  `;

const Heading = (...content) => `<h1>${content.join("\n")}</h1>`;
const Paragraph = (...content) => `<p>${content.join("\n")}</p>`;

async function main(url, data) {
  return Page(
    Heading("Version Originale films near Limoux"),
    Paragraph(
      `Information sourced from <a href="${url}">Cinefil</a>. Source code on <a href="https://github.com/alistairjcbrown/vo-films-near-limoux">Github</a>.`,
    ),
    Paragraph(
      `Site generated on ${new Date().toLocaleDateString("en-GB", options)} at ${new Date().toTimeString()}`,
    ),
    `<hr />`,
    ...data.map(Venue),
  );
}

module.exports = main;
