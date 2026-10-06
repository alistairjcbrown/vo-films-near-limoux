// Run with `npm test`. Fixtures are real pages saved by the nightly build
// (refresh them with scripts/update-fixtures.js), so these tests pin the
// parser to Cinefil's actual markup. Expects TZ=Europe/Paris, as the build does.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseVenues, parseSeances, upcomingVoShowings } = require("../parse");

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

// When the fixtures were captured (16:24 in Paris).
const CAPTURED_AT = Date.parse("2026-10-01T14:24:00Z");

test("parseVenues reads every venue's id, name and town", () => {
  const venues = parseVenues(fixture("seances-cinema_limoux-11.html"), "url");

  assert.deepEqual(
    venues.map(({ id, name, location }) => ({ id, name, location })),
    [
      { id: "elysee-limoux", name: "Elysée", location: "Limoux" },
      { id: "le-familia-quillan", name: "Le Familia", location: "Quillan" },
      {
        id: "colisee-carcassonne",
        name: "CGR Le Colisée",
        location: "Carcassonne",
      },
      {
        id: "cgr-carcassonne-carcassonne",
        name: "CGR Carcassonne",
        location: "Carcassonne",
      },
      {
        id: "espace-culturel-andre-malraux",
        name: "Espace Culturel ANdré Malraux",
        location: "Mirepoix",
      },
      { id: "le-casino-lavelanet", name: "Le Casino", location: "Lavelanet" },
      {
        id: "veo-castelnaudary",
        name: "Veo Castelnaudary",
        location: "Castelnaudary",
      },
      {
        id: "palace-lezignan-corbieres",
        name: "Le Palace",
        location: "Lézignan-Corbières",
      },
      {
        id: "cine-get-centre-culturel-de-revel-toulouse",
        name: "Revel - Ciné Get",
        location: "Revel",
      },
      {
        id: "cinema-le-casino-ax-les-thermes",
        name: "Le Casino",
        location: "Ax-les-Thermes",
      },
    ],
  );
  for (const venue of venues) {
    assert.equal(
      venue.url,
      `https://www.cinefil.com/cinema/${venue.id}/programmation`,
    );
  }
});

test("parseSeances reads every seance on a page, in any language", () => {
  const seances = parseSeances(
    fixture("cinema_colisee-carcassonne_programmation.html"),
    "url",
  );

  assert.equal(seances.length, 75);
  assert.equal(seances.filter(({ language }) => language === "vo").length, 32);
  assert.equal(seances.filter(({ language }) => language === "vf").length, 43);
  assert.deepEqual(
    seances.find(({ title }) => title === "Raison et sentiments"),
    {
      id: "raison-et-sentiments-2026-NL",
      title: "Raison et sentiments",
      date: "2026-10-01",
      time: "15:55",
      language: "vo",
      formats: [],
      startsAt: new Date("2026-10-01T15:55"),
    },
  );
});

test("upcomingVoShowings keeps future VO showings, soonest first", () => {
  const seances = parseSeances(
    fixture("cinema_elysee-limoux_programmation.html"),
    "url",
  );

  assert.equal(seances.length, 8);
  assert.deepEqual(upcomingVoShowings(seances, CAPTURED_AT), [
    { id: "romeria-NL", title: "Romería", date: "2026-10-04", time: "15:00" },
    {
      id: "rue-malaga-NL",
      title: "Rue Málaga",
      date: "2026-10-04",
      time: "17:30",
    },
    {
      id: "les-dimanches-NL",
      title: "Les dimanches",
      date: "2026-10-04",
      time: "21:00",
    },
  ]);
});

test("upcomingVoShowings drops showings that have already started", () => {
  const seances = parseSeances(
    fixture("cinema_colisee-carcassonne_programmation.html"),
    "url",
  );
  const raisonTimes = (showings) =>
    showings
      .filter(({ title }) => title === "Raison et sentiments")
      .map(({ date, time }) => `${date} ${time}`);

  const upcoming = raisonTimes(upcomingVoShowings(seances, CAPTURED_AT));
  assert.ok(!upcoming.includes("2026-10-01 15:55"));
  assert.ok(upcoming.includes("2026-10-01 20:40"));
});

test("a venue with no VO seances yields no showings, not an error", () => {
  const seances = parseSeances(
    fixture("cinema_le-familia-quillan_programmation.html"),
    "url",
  );

  assert.equal(seances.length, 5);
  assert.deepEqual(upcomingVoShowings(seances, CAPTURED_AT), []);
});

// Minimal pages in the shape of the real markup, for the cases the fixtures
// don't happen to cover.
const programmation = (seanceAttrs) => `
  <nav class="jours-bar">
    <button class="dayselector Jeudi" data-day="Jeudi" data-date="2026-10-01"></button>
  </nav>
  <ul>
    <li data-movie-slug="film">
      <span id="film-NL"></span>
      <h3 itemprop="name"><a>Film</a></h3>
      <div class="tab-pane lesseances Jeudi">
        <ul class="seances-list">
          <li ${seanceAttrs}><span class="seance-time">20:00</span></li>
        </ul>
      </div>
    </li>
  </ul>`;

const venuesPage = (row) => `<div class="ville-salles">${row}</div>`;
const venueRow = ({
  href = "https://www.cinefil.com/cinema/le-cinema/programmation",
  heading = "Le Cinéma (Ville)",
  address = "1 rue du Port 11000 Ville",
} = {}) => `
  <div class="row">
    <div><a class="fiche-cinema-minia" href="${href}"><img></a></div>
    <div><h3><a>${heading}</a></h3><div>${address}</div></div>
  </div>`;

test("parseSeances separates the language from other format tags", () => {
  const [seance] = parseSeances(programmation('data-f="vo sme ad"'), "url");

  assert.equal(seance.language, "vo");
  assert.deepEqual(seance.formats, ["sme", "ad"]);
});

test("parseSeances throws on a seance with no language tag", () => {
  assert.throws(
    () => parseSeances(programmation('data-f="3d"'), "url"),
    /Could not read language/,
  );
  assert.throws(
    () => parseSeances(programmation(""), "url"),
    /Could not read language/,
  );
});

test("parseSeances throws when the day bar is missing", () => {
  assert.throws(
    () => parseSeances("<p>Just a moment...</p>", "url"),
    /No day\/date bar/,
  );
});

test("parseVenues takes the town from the address", () => {
  const [venue] = parseVenues(
    venuesPage(
      venueRow({ heading: "Le Cinéma", address: "1 rue 11300 Limoux" }),
    ),
    "url",
  );

  assert.equal(venue.name, "Le Cinéma");
  assert.equal(venue.location, "Limoux");
});

test("parseVenues throws on markup it can't read", () => {
  assert.throws(
    () => parseVenues("<p>Just a moment...</p>", "url"),
    /No venues/,
  );
  assert.throws(
    () => parseVenues(venuesPage(venueRow({ href: "/cinema/x" })), "url"),
    /Unexpected venue link/,
  );
  assert.throws(
    () => parseVenues(venuesPage(venueRow({ heading: "" })), "url"),
    /Could not read a venue name/,
  );
  assert.throws(
    () => parseVenues(venuesPage(venueRow({ address: "" })), "url"),
    /Could not read a venue town/,
  );
});
