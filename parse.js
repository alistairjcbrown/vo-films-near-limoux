// Pure parsing of Cinefil pages: HTML in, data out. Kept separate from the
// (Cloudflare-fighting) fetching in get-data.js so it can be tested offline
// against saved pages - see test/fixtures.
const cheerio = require("cheerio");

const VENUES_SELECTOR = ".adresses a.fiche-cinema-minia";

// The day bar at the top of the page is the only place each day's ISO date
// appears; the per-movie panes below carry just the weekday name. Build the
// name -> date map once per page. The window is seven days, so weekday names
// are unambiguous. (Other elements reuse the .dayselector class without a
// date - the "prochaine seance le Samedi" buttons - hence the attribute
// selector and the .jours-bar scope.)
const DAY_BAR_SELECTOR = ".jours-bar .dayselector[data-day][data-date]";

// Each seance <li> carries the site's own filter tags in data-f, e.g. "vo",
// "vf 3d" or "vo sme ad" - the same tags its VO/VF filter uses - so they're a
// sturdier signal than the visible "VO" label.
const SEANCE_SELECTOR = ".seances-list > li";
const LANGUAGES = ["vo", "vf"];

const collapseWhitespace = (text) => text.replace(/\s+/g, " ").trim();

function parseVenues(html, url) {
  const $ = cheerio.load(html);

  const venues = $(VENUES_SELECTOR)
    .map(function () {
      const venueUrl = $(this).attr("href") ?? "";
      const idMatch = venueUrl.match(
        /^https:\/\/www\.cinefil\.com\/cinema\/([^/]+)\/programmation/,
      );
      if (!idMatch) {
        throw new Error(
          `Unexpected venue link "${venueUrl}" on ${url} - expected ` +
            `https://www.cinefil.com/cinema/<id>/programmation`,
        );
      }

      // The programmation link is a thumbnail with no text. The heading in the
      // same .row holds the name, plus "(Town)" for venues outside Limoux; the
      // address line below it always ends "<postcode> <Town>", so that's where
      // the town comes from.
      const $row = $(this).closest(".row");
      const heading = collapseWhitespace($row.find("h3 > a").first().text());
      const name = heading.replace(/\s*\([^)]*\)$/, "");
      const address = collapseWhitespace($row.find("h3 + div").text());
      const location = address.match(/\b\d{5}\s+(.+)$/)?.[1];
      if (!name || !location) {
        throw new Error(
          `Could not read a venue ${name ? "town" : "name"} for ${venueUrl} on ` +
            `${url} - the HTML structure has likely changed.\n` +
            `Venue HTML: ${$row.toString()}`,
        );
      }

      return { id: idMatch[1], name, location, url: venueUrl };
    })
    .get();

  if (venues.length === 0) {
    throw new Error(
      `No venues found at ${url} - the page may be blocked or its structure may have changed`,
    );
  }

  return venues;
}

function getDatesByDay($, url) {
  const datesByDay = new Map();
  $(DAY_BAR_SELECTOR).each(function () {
    datesByDay.set(
      $(this).attr("data-day").toLowerCase(),
      $(this).attr("data-date"),
    );
  });

  if (datesByDay.size === 0) {
    throw new Error(
      `No day/date bar found on ${url} - the page may be blocked or the HTML ` +
        `structure may have changed`,
    );
  }

  return datesByDay;
}

// A seance element we can find but can't read is always a bug, never a real
// state of the page - so treat any missing field as a structural change and
// throw. Without this, an unreadable field just yields an unparseable date, the
// showing silently fails the "is it in the future" filter, and we publish a page
// claiming there are no VO films at all.
function parseSeance($, $seance, datesByDay, url) {
  const $movie = $seance.closest("li[data-movie-slug]");
  // Each day's showings sit in a tab pane tagged only with the French weekday
  // name, e.g. "tab-pane lesseances Mardi" - the ISO date lives solely in the
  // day bar, hence the lookup. Matching on the name beats counting the pane's
  // position among its siblings, which silently skews if a day is ever omitted.
  const paneClasses = ($seance.closest(".tab-pane").attr("class") ?? "").split(
    /\s+/,
  );
  const date = paneClasses
    .map((className) => datesByDay.get(className.toLowerCase()))
    .find(Boolean);
  const time = $seance.find(".seance-time").text().trim();
  const title = collapseWhitespace($movie.find('h3[itemprop="name"]').text());
  // The movie's scroll-target span, used to deep-link to it on Cinefil.
  const id = $movie.children("span").attr("id");
  const tags = ($seance.attr("data-f") ?? "").split(/\s+/).filter(Boolean);
  const language = tags.find((tag) => LANGUAGES.includes(tag));

  const seance = { id, title, date, time, language };
  const missing = Object.keys(seance).filter((key) => !seance[key]);
  const startsAt = new Date(`${date}T${time}`);
  if (missing.length > 0 || Number.isNaN(startsAt.getTime())) {
    throw new Error(
      `Could not read ${missing.length > 0 ? missing.join(", ") : "a valid date/time"} ` +
        `from a seance on ${url} - the HTML structure has likely changed.\n` +
        `Parsed: ${JSON.stringify(seance)}\n` +
        `Seance HTML: ${$seance.toString()}`,
    );
  }

  // Anything beyond the language: "3d", "ice", "sme" (subtitles for the deaf
  // and hard of hearing), "ad" (audio description).
  const formats = tags.filter((tag) => tag !== language);
  return { ...seance, formats, startsAt };
}

// Parses every seance, not just the VO ones, so the checks in parseSeance
// still run on a day when nothing happens to be showing in VO.
function parseSeances(html, url) {
  const $ = cheerio.load(html);
  const datesByDay = getDatesByDay($, url);
  return $(SEANCE_SELECTOR)
    .map((index, el) => parseSeance($, $(el), datesByDay, url))
    .get();
}

function upcomingVoShowings(seances, now = Date.now()) {
  return seances
    .filter(({ language, startsAt }) => language === "vo" && now < startsAt)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map(({ id, title, date, time }) => ({ id, title, date, time }));
}

module.exports = {
  VENUES_SELECTOR,
  DAY_BAR_SELECTOR,
  parseVenues,
  parseSeances,
  upcomingVoShowings,
};
