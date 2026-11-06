# Data

How the dataset is built: where each field comes from, how the sources are merged, and the rules for
nationality, agency and what counts as a spaceflight. The [README](README.md#data) has the short version.

Committed files in `src/lib/data/` drive the app: `astronauts.min.json` and `meta.json`. Every script
also writes `astronauts.json`, a pretty-printed copy of the same data, so each refresh shows up as a
readable per-field diff. Regenerate them with:

```bash
bun run update-data            # 1. Wikidata + ISS APIs base — no rate limits, ~1 min
bun run enrich-ll2             # 2. Launch Library 2 — authoritative; rate-limited, resumable
bun run enrich-supercluster    # 3. Supercluster — nationalities; gap-fills gender & tourist agencies; cross-checks agencies
bun run enrich-manual          # 4. Manual overrides — hand-fix anything; empty a field to revert
```

## Wikidata and Launch Library 2

`update-data` builds a complete, self-sufficient dataset from Wikidata. Dates keep the precision Wikidata
gives them: a birth date known only to the year or month is stored as `1988` or `1975-10` and shown as
"1988" or "Oct 1975" — never padded to the 1st, which would invent a birthday. **Launch Library 2** enrichment
then runs as the **authoritative source** wherever it and Wikidata disagree — Wikidata supplies the base
(the crew list, dates, photos, gender, dob/dod) and LL2 corrects four things on top of it, then backfills
the people Wikidata never had:

- **Nationality** — LL2's demonym overrides Wikidata, which often stores a *birthplace* (Kononenko
  was tagged Turkmenistan, not Russia) or a stale/secondary citizenship. (Supercluster then supplies
  the full list — see [Nationalities](#nationalities).)
- **Agency** — LL2's affiliation fills the gaps Wikidata leaves blank (e.g. Yi So-yeon → Korean
  Astronaut Program) and sharpens the rest. It's the person's *present-day* agency, so it's then dated
  flight by flight (see [Agencies](#agencies)). Where LL2 has a person but lists *no* agency, that's
  trusted too: early space tourists (Tito, Simonyi…) are left agency-less rather than inheriting a
  nation-default like NASA.
- **Flight timelines** — each person's flights are rebuilt by zipping their LL2 launches with their
  returns, so the Gantt bars show real intervals (and seat-swap up/down craft, e.g. Kononenko's
  record MS-24→MS-25 mission).
- **Days in space** — taken from LL2's lifetime `time_in_space`, but only when those rebuilt flights
  corroborate it. Wikidata derives days from each *spacecraft's* launch/landing dates, over-counting
  every seat-swapping crew member (a visitor inherits the craft's whole 6-month span instead of their
  ~10-day stay): Kononenko →1110, Whitson →695, Avdeyev 1142→747. The dozen Apollo/Gemini/Skylab
  veterans whose LL2 `time_in_space` is itself buggy (e.g. Conrad) keep their correct Wikidata figure.

### Backfill, and what counts as a spaceflight

And then it **backfills people Wikidata is missing**. Wikidata has no item (or no crew-link) for most
recent suborbital tourists, so the base list stops ~700; LL2 catalogues ~800 who have flown, and anyone
it lists as flown but no Wikidata person matched is added as a new record (`id: "ll2-<id>"`). This is the
broad **US 50-mile / 80 km** definition the dataset already uses — it counts Virgin Galactic, whose
SpaceShipTwo tops out ~85 km, below the 100 km Kármán line (so the total runs a little above the
Kármán-only tally you'll see quoted elsewhere). Three things are deliberately left out: non-human test
articles LL2 lists as astronauts (Starman, the Artemis-I manikins, zero-g-indicator plushes…),
name-variant duplicates already in the set (caught by an exact-DOB guard), and "flights" that never
reached space — the SpaceShipTwo glide/powered atmospheric tests, and the crewed launches listed in
[`scripts/spaceflight.ts`](scripts/spaceflight.ts): the Apollo 1 pad fire, Soyuz T-10-1's pad abort,
Challenger's breakup on STS-51-L (~15 km up), VSS Unity VF-02, whose motor never lit, and VSS Unity 24, a
glide test numbered like a spaceflight. Wikidata logs
some of those launches too, so `update-data` drops them as well. That trims real astronauts' logs
(Scobee, Titov; Sturckow 17→10) and leaves out anyone with no other flight — Chaffee, and Challenger's
McAuliffe, Jarvis and Smith. Two aborts did cross 80 km on a ballistic arc, so they stay, marked
suborbital: Soyuz 18a (1975, ~190 km) and MS-10 (2018, ~93 km), listed in the same file, since neither
source marks them so (LL2 gives the orbit they were bound for). LL2 carries no gender, so backfilled
people take theirs from bio pronouns where present, else `unknown`.

### Fetching and caching

It fetches the astronaut list with `?mode=detailed` (flights & landings inlined), so a full refresh
is **~9 paginated calls**. LL2's free tier is heavily rate-limited (~15 calls/hour), so the script
paces calls, honours `Retry-After`, backs off, and caches every page — it **resumes** wherever it
left off. Cached pages expire after 6 hours, so the next run picks up launches and landings since
rather than replaying an old snapshot. An old snapshot replayed on purpose (`MAX_LL2_CALLS=0`) still
gives the same result as the run that fetched it: anyone in space is measured up to when their page
was fetched, not up to today. And because LL2 can lag Wikidata (e.g. right after a launch), a
flight Wikidata already has but LL2 hasn't logged is kept rather than rolled back. It also fills
spacewalk counts and missing photos.

```bash
bun run enrich-ll2                     # run AFTER update-data; re-run later to resume
MAX_LL2_CALLS=100 bun run enrich-ll2   # cap network calls this run (resume later)
MAX_LL2_CALLS=0   bun run enrich-ll2   # apply cached pages only, no network
LL2_CACHE_HOURS=0 bun run enrich-ll2   # re-fetch every page now (default: reuse pages < 6h old)
LL2_DELAY_MS=4000 bun run enrich-ll2   # gentler pacing (default 2000ms)
LL2_API_KEY=…     bun run enrich-ll2   # authenticated tier — higher throttle ceiling
```

## Supercluster

**Supercluster** runs next. From [Supercluster's astronaut database](https://www.supercluster.com/astronauts)
(~800 humans who have reached space, fetched from its public Sanity API — no key, no rate limit) it
supplies everyone's **nationalities** (see below), and otherwise fills gaps — it never overrides LL2's
agency wholesale. Three gap-filling jobs: it fills **gender** for the recent suborbital tourists LL2
leaves blank (it lists nearly everyone); sets **Space Adventures** as the agency for the orbital tourists it brokered (Tito, Simonyi,
Shuttleworth, Olsen, Ansari, R. Garriott, Laliberté) plus the dearMoon pair Maezawa & Hirano (whom
Wikidata mis-tagged as JAXA); and fills a still-empty agency only when Supercluster names a
*commercial* provider. It also **backfills the two SpaceShipOne pilots** (Melvill & Binnie — the first
commercial astronauts, 2004) that LL2's filters drop. Supercluster lists several agencies per person,
but it isn't copied — it **cross-checks** ours instead (see [Agencies](#agencies)).

```bash
bun run enrich-supercluster                  # run AFTER enrich-ll2
SC_MAX_CALLS=0 bun run enrich-supercluster    # apply cached data only, no network
```

## Nationalities

A person can have several — `nationalities` lists them primary first: every state they **flew for**,
named as it was then, plus any other citizenship they **held when they flew**. So Gagarin is Soviet
Union; Krikalev, in orbit as the USSR dissolved and flying again in 1994, is Soviet Union + Russia;
Merbold flew for West Germany in 1983, then for reunified Germany; Jähn flew for East Germany and
Remek for Czechoslovakia; Foale is United States + United Kingdom. Heritage alone doesn't count
("Italian-American", or Aisha Bowe's Bahamian roots), nor does a citizenship gained after flying
(Mohmand became German in 2003). Only sovereign states are used — Puerto Rico counts as the United
States, and the EU is dropped.

Each source layer maps its own vocabulary onto the names in
[`src/lib/countries.ts`](src/lib/countries.ts), then [`scripts/nationality.ts`](scripts/nationality.ts)
settles the result:

- **Supercluster's list wins** where it has one — it alone lists defunct states and second
  citizenships. LL2's single demonym (often a birthplace: Popovich → Ukrainian) and Wikidata's guess
  are fallbacks.
- **Former states go by flight date**: a flight before 26 Dec 1991 counts for the Soviet Union and
  one ending after it for Russia (or whichever successor the sources name); likewise Czechoslovakia
  before 1993, and West Germany before reunification on 3 Oct 1990. This also catches what
  Supercluster misses (Titov's 1995/97 Russian flights).
- **A researched list** corrects the two dozen people every source gets wrong or incomplete — checked
  against Wikipedia's time-of-flight
  [List of space travelers by nationality](https://en.wikipedia.org/wiki/List_of_space_travelers_by_nationality),
  mission crew records and each person's article (e.g. Owolabi Salis → Nigeria, Chun Wang → Malta +
  Saint Kitts and Nevis, Jessica Meir → United States + Sweden).

Every write warns about anyone left without a nationality, or with a country missing from
`countries.ts`.

**Flags** are round SVGs from [circle-flags](https://github.com/HatScripts/circle-flags) (MIT, a
devDependency), named by ISO code — defunct states keep their retired codes (`su`, `dd`, `cs`; West
Germany shares Germany's `de`). `src/lib/assets/flags/` holds copies of only the flags the data uses,
so the build ships no others: every dataset write syncs it ([`scripts/flags.ts`](scripts/flags.ts)),
copying in a newly needed flag and dropping unused ones. The few flags circle-flags lacks are drawn to
match in `scripts/flags/` (East Germany). So a new country needs only its line in `countries.ts` —
plus a drawing there if circle-flags has no flag for it.

```bash
bun run flags    # sync src/lib/assets/flags with the data by hand (e.g. after adding to scripts/flags/)
```

## Agencies

A person can have several agencies too — `agencies` lists every one they flew for, oldest first, **as it
was when they flew**. Wakata flew for NASDA in 1996 and 2000, then for JAXA; Krikalev for the Soviet
programme (CCCP), then Roscosmos; Garneau for Canada's National Research Council in 1984, before the
Canadian Space Agency existed; Engle flew the X-15 for the US Air Force and the Shuttle for NASA; Whitson
flew for NASA, then Axiom Space. [`scripts/agency.ts`](scripts/agency.ts) settles them:

- **Who counts** — a government astronaut flies for the agency (or armed force) that employed them then;
  a guest on another country's spacecraft for their own agency or programme, not the host's (a JAXA
  astronaut on the Shuttle is JAXA; the Soviet bloc's guests flew under Interkosmos); a paying customer
  for the company that ran or sold the flight (Space Adventures for the Soyuz tourists). Payload
  specialists on NASA's science missions flew for NASA whoever employed them; those on Defense Department
  missions, for their armed service.
- **Succession by flight date** — the sources only know someone's present-day agency, so each flight is
  dated: before 26 Dec 1991 it was the Soviet programme's (Roscosmos began in Feb 1992; a flight aloft
  across both counts for both), before Oct 2003 NASDA's rather than JAXA's, before 1989 the NRC's rather
  than the CSA's.
- **Commercial missions** — a flight a company ran counts for it (Axiom Space, Virgin Galactic, Blue
  Origin, SpaceX's private flights), beside the agency that bought the seat: Shukla flew Ax-4 for ISRO and
  Axiom Space. A company that only provides the ride to an agency's own mission doesn't count — NASA's
  Crew Dragon and Starliner crews flew for NASA, not SpaceX or Boeing.
- **A researched list** settles about fifty people the rules and sources get wrong or incomplete,
  checked against their Wikipedia articles, ESA's history of its astronaut corps (France and Germany
  merged theirs into ESA's from 1998, so Eyharts flew for CNES in 1998 and for ESA in 2008) and mission
  records.

One organization is one entry: an agency that merged into or was replaced by another is its own (NASDA,
the NRC, CCCP), while a mere rename stays under today's name with its earlier names noted (Roscosmos was
the Russian Space Agency in 1994). Each is keyed by its short name in
[`src/lib/agencies.ts`](src/lib/agencies.ts), with its full name and a line of history. The app shows the
short name first; the full name is in the detail panel, on hover, and under each filter entry with
**Full names**.

**Supercluster** lists several agencies per person too, but it mixes in who *selected* someone (NASDA
for Hoshide, who first flew in 2008; CNES for Pesquet) and the launch provider (SpaceX for every Crew
Dragon flier), so it's a cross-check rather than a source: each run reports anyone it gives an agency we
don't — after dating its list by flight and dropping launch providers — for review in `scripts/agency.ts`.
Every write also warns about anyone with no agency, or one missing from `agencies.ts`.

## Stations

The station pages show the twelve **Stations** that have had a crew — Salyut 1, 3, 4, 5, 6 and 7, Skylab,
Mir, the ISS, Tiangong-1, Tiangong-2 and Tiangong — each with its **Expeditions** and everyone who stayed
aboard. The words are defined in [CONTEXT.md](CONTEXT.md); the two choices that shape the data are in
[docs/adr/](docs/adr/). [`scripts/stations.ts`](scripts/stations.ts) builds it all inside `enrich-ll2`, from
three more Launch Library 2 endpoints (~9 calls, paced and cached like the astronaut pages, and replayed
offline the same way): the space stations, for each one's launch and deorbit dates; the expeditions, with
their crews; and the docking events.

- **Stays** — a person's time aboard one Station, from the docking of the craft they arrived in to the
  undocking of the one they left in. A docking event names no crew, only the launch of the craft that
  docked, so the crew comes from the astronaut records: the craft someone rode up boards them at its
  docking, the craft they came home in takes them off at its undocking. That handles seat-swaps (Thagard
  up on Soyuz TM-21, home on STS-71) and Shuttle crews swapping in (Solovyev and Budarin up on Atlantis
  for a stay on Mir). Moving a craft to another port doesn't end a Stay; flying to another Station does,
  so Soyuz T-15 makes three — Mir, Salyut 7, Mir. Where LL2 lacks a docking, the Stay takes that end from
  the flight and is marked approximate. Stays are stored on the flights in `astronauts.json`
  (docs/adr/0002); `stations.json` holds the Stations' lifetimes and the Expeditions.
- **Expedition crew or Visitor** — an Expedition is a Station's long-duration resident crew for one
  continuous stretch, named as that Station named it: Expedition 72, Mir's EO-27, Skylab 4, Shenzhou 19.
  A Stay belongs to every Expedition whose LL2 crew list names that person during it (Pesquet's one Stay
  is Expeditions 50 and 51); a Stay in none is a **Visitor**'s — Shuttle crews docked at Mir or the ISS,
  week-long Soyuz crews, Interkosmos cosmonauts, private-mission crews and tourists. It describes the Stay, not the
  person: Scott Kelly was a Visitor on STS-118 and Expedition crew later.

LL2 calls more things expeditions than that, and gets some dockings wrong, so researched lists in
`scripts/stations.ts` sort it out before anything is built — lists rather than rules, because neither
obvious rule holds. By length ("an Expedition lasts 30 days or more"), Salyut 1's only crew (Soyuz 11,
23 days) would be Visitors, and Merbold's 31-day Stay on Mir an Expedition; by nesting ("a Stay inside
another crew's is a Visitor's"), residents would be Visitors, since Rubio's 371-day Stay holds other
residents' whole ones.

- **Visitor crews** — the LL2 records that aren't Expeditions: Salyut 6 and 7's week-long
  visiting crews, Ax-1 to Ax-4, Maezawa's Soyuz MS-20 and the "Challenge" film crew — plus individual
  Visitors a resident record lists (Ivan Bella in Mir EO-27, Marina Vasilevskaya in Expedition 70).
- **Never aboard** — crews who reached a Station but didn't go in: Soyuz 10, which docked to Salyut 1
  but couldn't open the hatch, and the failed dockings LL2 lists as expeditions (Soyuz 15, 23, 25, 33,
  T-8).
- **Docking corrections** — craft whose dockings LL2 lacks or has wrong, replaced by the missions'
  records: Soyuz T-15's Flight between Mir and Salyut 7; Mir's missing Soyuz TM-24 and STS-76; the
  1987–88 Soyuz craft whose undockings LL2 files under the next craft; and the undockings of Soyuz 11
  and TM-28.

Every write warns, never fails, about a Stay of 30 days or more in no Expedition (a crew list someone was
left off), an Expedition member aboard at none of its dates, and any Station or Expedition the registry
([`src/lib/stations.ts`](src/lib/stations.ts)) or the dataset doesn't know — and checks the ISS crews
against Wikidata's, from a cached query `enrich-ll2` refreshes. `enrich-ll2`'s own report adds the
crews it couldn't put aboard. Those warnings found LL2's biggest gap: from 2020 its ISS crew lists name
each Expedition's arrivals but not the crews still aboard from the one before, which the Expedition
corrections below fill in.

`bun test` checks the result against known history (each Station's time in orbit, T-15's three Stays, the
STS-71 crews, Soyuz 10, the Visitor crews…) and rules every record must keep, such as each Stay lying within
its flight, and each ISS Expedition handing over to the next.

**Checked against other sources.** In November 2026 every Station, Expedition and Stay was compared with
three sources independent of LL2: [Spacefacts](http://www.spacefacts.de)' mission and expedition pages for
dockings, undockings and crews, Wikipedia's Expedition articles and lists, and Jonathan McDowell's
[satellite catalogue](https://planet4589.org/space/gcat/) for launches and re-entries. What LL2 had wrong is
now corrected in the Manual overrides. Where the sources disagree on how to count, LL2's reading stays:
Spacefacts alone also lists Skripochka and Meir in Expedition 60, and doesn't count Soyuz T-3's crew as Salyut 6
EO-5. Dates are UTC, like those from the docking events. Four are left at the date they're known by, a day later
than UTC because they fell around midnight local time: Salyut 3's launch (22:38 UTC on 24 June 1974), Mir's
launch (21:28 UTC on 19 February 1986), Salyut 4's re-entry (around midnight UTC on 2–3 February 1977) and
Shenzhou 10's undocking (23:05 UTC on 24 June 2013). Comparing the flights with Spacefacts' mission pages the
same way turned up four Missions whose landing the pipeline has wrong — Apollo 17 and STS-3 landing on launch
day, STS-44 and Inspiration4 a day late — also corrected in the Manual overrides.

## Manual overrides

**Manual overrides** run last (`scripts/overrides.ts` → `bun run enrich-manual`). Every other layer
derives values from a source; this one is hand-authored, so it has the final say. List a person by
`id`, `slug`, or exact `name`, then set any [`Person`](src/lib/types.ts) field to correct it — the
value wins over everything the pipeline computed. **Empty a field** (`''`, `null`, `[]`, or just
delete the line) and the override drops, so the field falls back to the pipeline's value — _the last
value that was there before_. (So this layer can only set values, never blank them; emptying means
revert. To genuinely clear a field, fix it upstream.) Overriding `flights` replaces the whole array
and recomputes `firstLaunch` / `lastLanding` / `totalDaysInSpace` / `status` from it — Stays included, so
restate those of anyone who has them.

**Flight, Station, Stay and Expedition corrections**, in the same file, work the same way on many records at
once:

- **`flightOverrides`** — a Mission's `landing` the pipeline has wrong, for its whole crew, so nobody's `flights`
  need restating. Key each by `<mission>/<date>`, with the landing as the pipeline has it (`STS-44/1991-12-02`),
  so anyone who came home in another craft keeps theirs. Each one's `lastLanding` moves with it, and their
  `totalDaysInSpace` by as many days: LL2's `time_in_space` carries the same error, hours and all. `remove: true`
  drops a "flight" that never reached space instead, re-dating its crew's first and last flights; until a full
  rebuild applies a new entry in `scripts/spaceflight.ts`, that's how VSS Unity 24 is kept out. It won't remove
  anyone's only flight — that's a person who isn't in the dataset, which takes the upstream list. A person's own
  `flights`, or a field moved here, set in their override wins.
- **`stationOverrides`** — a Station's `launched` or `deorbited`, keyed by its slug (`salyut-5`).
- **`stayOverrides`** — a craft's docking or undocking date LL2 has wrong, for everyone it carried, so nobody's
  `flights` need restating. Key each by `<station>/<date>`, with the date as the pipeline has it: `depart` moves
  every Stay aboard that Station that ended that day (`iss/2008-03-26` → all who left in STS-123, whichever craft
  they came up in), and `arrive` every one that began that day.
- **`expeditionOverrides`** — keyed by `<station>/<expedition>`, as `stations.json` has them (`iss/expedition-72`,
  `mir/eo-27`), since names repeat across Stations. Set its `start`, `end`, `name` or `station`, or its `crew`:
  the slugs of everyone in it. A crew list is the whole crew — the Expedition is added to those people's Stays
  aboard the Station during it and taken off anyone else's. `remove: true` drops a record that isn't really an
  Expedition (LL2's `EO-4-1b`, half of a split crew).

Reverting works without re-running the whole chain: a gitignored baseline
(`scripts/cache/manual/baseline.json`) remembers each touched field's pipeline value and the value
written, so emptying an override restores the former. It only reverts a field still holding exactly
what it wrote, so a later LL2/SC change is respected. `update-data` discards the baseline, since its
fresh base holds no overrides — so after a full re-run, an override the pipeline has made redundant can
be deleted without the field rolling back to the stale value it once replaced.

```bash
bun run enrich-manual    # apply scripts/overrides.ts as the final layer (idempotent, offline)
```

## Sources

**Wikidata** (CC0, base dataset),
**[International Space Station APIs](https://github.com/corquaid/international-space-station-APIs)**
(MIT, in-space cross-check), **Launch Library 2** (CC BY-NC 4.0 — authoritative for agency, day
counts, timelines & backfilling the people Wikidata misses, and the source of the station data: Stations,
Expeditions and docking events; Wikidata's ISS crews cross-check it) and **Supercluster** (editorial —
nationalities, gender, the Space Adventures tourists, the SpaceShipOne pilots, and an agency
cross-check). See the in-app About page for methodology.
