const cheerio = require("cheerio");
const { addDays, format } = require("date-fns");
const staticData = require("./data.json");

async function getPage(url) {
  const response = await fetch(url);
  const data = await response.text();
  return cheerio.load(data);
}

async function getVenues(url) {
  const $ = await getPage(url);

  const venues = [];
  $(".list_cities a").each(function () {
    const url = $(this).attr("href");
    const [, id] = url.match(
      /https:\/\/www.cinefil.com\/cinema\/([^/]+)\/programmation/,
    );
    const value = $(this).text().trim();
    const match = value.match(/^([^(]+)\s+\(([^)]+)\)$/);
    let name = value;
    let location = "Limoux";
    if (match) [, name, location] = match;
    venues.push({ id, name, location, url });
  });
  return venues;
}

function getShowingFor($showingEl, $movieEl) {
  const index = $showingEl.parents(".tab-pane").index();
  const date = format(addDays(new Date(), index), "yyyy-MM-dd");
  const time = $showingEl.parent().find(".h4").text().trim();
  const title = $movieEl.find('meta[itemprop="name"]').attr("content");
  const id = $movieEl.children("span").attr("id");
  return { id, title, date, time };
}

async function getShowings({ url }) {
  const $ = await getPage(url);
  const showings = [];
  $("div.langue").each(function (index) {
    if ($(this).text().trim().toLowerCase() === "vo") {
      const showing = getShowingFor($(this), $(this).parents("li"), index);
      if (Date.now() < new Date(`${showing.date}T${showing.time}`)) {
        showings.push(showing);
      }
    }
  });
  return showings.sort(
    (a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`),
  );
}

async function main(url) {
  const venues = await getVenues(url);
  const venueShowings = [];
  for (venue of venues) {
    const showings = await getShowings(venue);
    venueShowings.push({ ...venue, ...staticData[venue.id], showings });
  }
  return venueShowings.sort(
    (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
  );
}

module.exports = main;
