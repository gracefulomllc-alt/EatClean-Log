// South Plains College (Levelland, TX) Texans men's basketball, 2026-27.
// Source: spctexans.com/sports/mbkb/2026-27/schedule. Times are as listed there (Central).
// start: ISO with offset (CDT -05:00 through Oct 31, CST -06:00 after). tba: true when the time isn't set yet.
// home: true = home, false = away, null = neutral site. conf: conference game.
export const SPC_URL = "https://www.spctexans.com/sports/mbkb/2026-27/schedule";
const D = "-05:00", S = "-06:00";
export const SPC_GAMES = [
  { start: `2026-10-02T15:00:00${D}`, opp: "Indian Hills CC", home: null, where: "Oklahoma City, OK", event: "OKC Jamboree" },
  { start: `2026-10-03T12:10:00${D}`, opp: "Cloud County CC", home: null, where: "Wichita Sports Forum", event: "All-American Jamboree" },
  { start: `2026-10-10T09:10:00${D}`, opp: "College of Southern Idaho", home: null, where: "Duncanville Fieldhouse", event: "Mullen JUCO Jamboree" },
  { start: `2026-10-10T11:30:00${D}`, opp: "Pratt CC", home: null, where: "Duncanville Fieldhouse", event: "Mullen JUCO Jamboree" },

  { start: `2026-11-05T18:00:00${S}`, opp: "Casper College", home: null, where: "Howard College", event: "Howard College Classic" },
  { start: `2026-11-10T12:00:00${S}`, tba: true, opp: "Dodge City CC", home: false },
  { start: `2026-11-13T10:00:00${S}`, opp: "Lamar State College - Port Arthur", home: false },
  { start: `2026-11-14T14:00:00${S}`, opp: "Angelina College", home: null, where: "Plano, TX" },
  { start: `2026-11-19T19:00:00${S}`, opp: "Trinidad State College", home: true, where: "Texan Dome", event: "Texan Classic" },
  { start: `2026-11-21T14:00:00${S}`, opp: "Tyler Junior College", home: true, where: "Texan Dome", event: "Texan Classic" },
  { start: `2026-11-29T12:00:00${S}`, tba: true, opp: "Lamar Community College", home: null, where: "Canyon, TX" },

  { start: `2026-12-03T18:00:00${S}`, opp: "Seminole State College", home: true, where: "Texan Dome", event: "Texan Classic" },
  { start: `2026-12-04T18:00:00${S}`, opp: "Weatherford College", home: true, where: "Texan Dome", event: "Texan Classic" },
  { start: `2026-12-05T18:00:00${S}`, opp: "Hill College", home: true, where: "Texan Dome", event: "Texan Classic" },
  { start: `2026-12-11T12:00:00${S}`, tba: true, opp: "Salt Lake Community College", home: false },
  { start: `2026-12-12T12:00:00${S}`, tba: true, opp: "Snow College", home: false },
  { start: `2026-12-17T17:45:00${S}`, opp: "Trinity Valley CC", home: null, where: "Las Vegas, NV", event: "Tarkanian Classic" },
  { start: `2026-12-18T20:00:00${S}`, opp: "North Idaho College", home: null, where: "Las Vegas, NV", event: "Tarkanian Classic" },

  { start: `2027-01-04T19:30:00${S}`, opp: "Odessa College", home: true, where: "Texan Dome", conf: true },
  { start: `2027-01-07T19:30:00${S}`, opp: "Midland College", home: true, where: "Texan Dome", conf: true },
  { start: `2027-01-11T19:30:00${S}`, opp: "Frank Phillips College", home: false, where: "Frank Phillips College", conf: true },
  { start: `2027-01-14T19:30:00${S}`, opp: "New Mexico Military Institute", home: true, where: "Texan Dome", conf: true },
  { start: `2027-01-18T17:00:00${S}`, opp: "New Mexico Junior College", home: false, where: "Caster Activity Center, Hobbs, NM", conf: true },
  { start: `2027-01-25T19:30:00${S}`, opp: "Western Texas College", home: false, conf: true },
  { start: `2027-01-28T19:30:00${S}`, opp: "Howard College", home: true, where: "Texan Dome", conf: true },

  { start: `2027-02-01T19:30:00${S}`, opp: "Clarendon College", home: false, where: "Clarendon College", conf: true },
  { start: `2027-02-04T19:30:00${S}`, opp: "Odessa College", home: false, where: "OC Sports Center, Odessa, TX", conf: true },
  { start: `2027-02-08T19:30:00${S}`, opp: "Midland College", home: false, where: "Chaparral Center, Midland, TX", conf: true },
  { start: `2027-02-11T19:30:00${S}`, opp: "Frank Phillips College", home: true, where: "Texan Dome", conf: true },
  { start: `2027-02-15T20:30:00${S}`, opp: "New Mexico Military Institute", home: false, where: "New Mexico Military Institute", conf: true },
  { start: `2027-02-18T19:30:00${S}`, opp: "New Mexico Junior College", home: true, where: "Texan Dome", conf: true },
  { start: `2027-02-25T19:30:00${S}`, opp: "Western Texas College", home: true, where: "Texan Dome", conf: true },

  { start: `2027-03-01T19:30:00${S}`, opp: "Howard College", home: false, where: "Dorothy Garrett Coliseum", conf: true },
  { start: `2027-03-04T19:30:00${S}`, opp: "Clarendon College", home: true, where: "Texan Dome", conf: true },
];
