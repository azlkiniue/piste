/**
 * Manual data overrides — the FINAL enrichment layer (applied by scripts/enrich-manual.ts, which
 * runs AFTER update-data → enrich-ll2 → enrich-supercluster).
 *
 * Every other layer derives values from a data source; this one is hand-authored, so it has the last
 * word. For each person you list, any field you give a VALUE to wins over whatever the pipeline
 * computed. Leave a field EMPTY — '' , null , [] , or just delete the line — to drop the override and
 * fall back to the pipeline's value ("the last value that was there before"). You therefore can't
 * blank a field from here: emptying only reverts. To truly clear a field, fix it upstream.
 *
 * Identify a person by `id` (Wikidata Q-number, or an `ll2-…` / `sc-…` backfill id), by `slug`
 * (e.g. "yuri-gagarin"), or by exact `name` — whichever you find easiest. Find them in
 * src/lib/data/astronauts.json.
 */
import type { Expedition, Person, StationLife } from '../src/lib/types';

// Dates are UTC, as the pipeline's are.

/** A subset of Person fields. The extra `'' | null` lets you "empty" a field to revert it. */
export type Override = { [K in keyof Person]?: Person[K] | '' | null };

/** A landing date to correct, on every Flight of a Mission that landed on a given date — or `remove: true` to drop
 *  those Flights. `'' | null` (or `remove: false`) empties it to revert. */
export type FlightOverride = { landing?: string | '' | null; remove?: boolean };

/** Station dates you can correct. `'' | null` empties a field to revert it, as for people. */
export type StationOverride = { [K in 'launched' | 'deorbited']?: StationLife[K] | '' | null };

/** A docking or undocking date to correct, on every Stay with that date. `'' | null` empties it to revert. */
export type StayOverride = { arrive?: string | '' | null; depart?: string | '' | null };

/** Expedition fields you can correct, plus `crew`: the slugs of everyone in it. Setting `crew` replaces the
 *  Expedition's membership — it's added to those people's Stays aboard the Station during it, and taken off
 *  anyone else's. `'' | null | []` empties a field to revert it, as for people. `remove: true` drops a record
 *  that isn't really an Expedition, off its crew's Stays too; give them another's `crew` if they belong in one. */
export type ExpeditionOverride = {
	[K in 'start' | 'end' | 'name' | 'station']?: Expedition[K] | '' | null;
} & { crew?: string[]; remove?: boolean };

export const overrides: Record<string, Override> = {
	// ───────── examples — delete or replace ─────────
	// 'yuri-gagarin': { agencies: ['CCCP'], image: 'https://example.com/gagarin.jpg' }, // keys from src/lib/agencies.ts
	// 'Q7327':        { nationalities: ['Soviet Union'] }, // names from src/lib/countries.ts, primary first
	// 'll2-690':      { agencies: [] }, // emptied → agencies revert to whatever the pipeline set
	//
	// Overriding `flights` replaces the whole array; firstLaunch / lastLanding / totalDaysInSpace /
	// status are then recomputed from it automatically (unless you set those explicitly too):
	// 'some-slug': {
	// 	flights: [
	// 		{ mission: 'Vostok 1', launch: '1961-04-12', landing: '1961-04-12', ongoing: false, orbital: true, approx: false }
	// 	]
	// }
	'tushar-shah': { nationalities: ['United States'] },
	'giorgio-manenti': { gender: 'male' },
	'russel-wilson': { gender: 'male' },
	'toyohiro-akiyama': { agencies: ['CCCP'] },
	'alan-shepard': {flights: [{"mission":"Mercury-Redstone 3","launch":"1961-05-05","landing":"1961-05-05","ongoing":false,"orbital":false,"approx":false},{"mission":"Apollo 14","launch":"1971-01-31","landing":"1971-02-09","ongoing":false,"orbital":true,"approx":false}]},
	'wang-haoze': {"flights":[{"mission":"Shenzhou 19","launch":"2024-10-29","landing":"2025-04-30","ongoing":false,"orbital":true,"approx":false,"stays":[{"station":"tiangong","arrive":"2024-10-30","depart":"2025-04-29","ongoing":false,"expeditions":["shenzhou-19"],"approx":false}]}]}
};

/**
 * Flight corrections, for a Mission whose landing date the pipeline has wrong for its crew. Key each by
 * `<mission>/<date>`: the Flight's `mission` and its landing as the pipeline has it, so anyone who came home in
 * another craft keeps theirs. Each one's last landing moves with it, and their days in space by as many days,
 * since the sources' totals carry the same error. `remove: true` drops a "flight" that never reached space, for
 * someone with others; one that's all someone flew belongs in scripts/spaceflight.ts. A person's own `flights`,
 * or a field moved here, set above wins. Dates checked against Spacefacts and Wikipedia's mission articles.
 */
export const flightOverrides: Record<string, FlightOverride> = {
	'Apollo 17/1972-12-07': { landing: '1972-12-19' }, // Cernan's record has it land on launch day; Evans's and Schmitt's are right
	'STS-3/1982-03-22': { landing: '1982-03-30' }, // landed at 16:04 UTC on the 30th; the pipeline has it land on launch day
	'STS-44/1991-12-02': { landing: '1991-12-01' }, // landed at 22:34 UTC on the 1st; LL2 has the 2nd, and its crew a day too many in space
	'Inspiration4/2021-09-19': { landing: '2021-09-18' }, // splashed down at 23:06 UTC on the 18th; likewise
	// An unpowered glide test from ~47,000 ft, not a spaceflight. scripts/spaceflight.ts now lists it, so the next
	// full rebuild drops it at the source and this shows as unmatched: delete it then.
	'VSS Unity 24/2023-04-26': { remove: true }
};

/**
 * Station corrections, applied by enrich-manual the same way: a value wins, an emptied one reverts. Key each
 * by its slug, from src/lib/stations.ts.
 */
export const stationOverrides: Record<string, StationOverride> = {
	'salyut-5': { deorbited: '1977-08-08' } // LL2 has 1988-08-08, eleven years after it came down
};

/**
 * Stay corrections, for a craft whose docking or undocking date LL2 has wrong. Key each by `<station>/<date>`,
 * with the date as the pipeline has it: `depart` moves every Stay aboard that Station that ended that day — all
 * who left in the craft, whichever one they came up in — and `arrive` every one that began that day. One
 * person's Stay alone is corrected through their `flights` above, which replaces the Stays with the flights.
 */
export const stayOverrides: Record<string, StayOverride> = {
	'tiangong-2/2016-11-14': { depart: '2016-11-17' }, // Shenzhou 11 undocked at 04:41 UTC on the 17th
	'iss/2008-03-26': { depart: '2008-03-25' } // STS-123 undocked at 8:25 p.m. EDT on the 24th, 00:25 UTC on the 25th
};

/**
 * Expedition corrections, applied by enrich-manual the same way: a value wins, an emptied one reverts.
 * Key each by `<station>/<expedition>` — slugs from src/lib/data/stations.json, since names repeat across
 * Stations (EO-1 is Salyut 6's, Salyut 7's and Mir's).
 */
export const expeditionOverrides: Record<string, ExpeditionOverride> = {
	// ───────── example ─────────
	// 'mir/eo-27': { end: '1999-08-28', crew: ['viktor-afanasyev', 'jean-pierre-haignere', 'sergei-avdeyev'] },
	//
	// Dates LL2 has wrong, checked against the missions' records on spacefacts.de and Wikipedia's articles.
	'salyut-4/soyuz-17': { start: '1975-01-10', end: '1975-02-09' }, // launched 21:43 UTC on the 10th, landed the 9th; LL2 has each a day late
	'tiangong-2/shenzhou-11': { end: '2016-11-17' }, // undocked on the 17th; LL2 has the 14th
	'tiangong/shenzhou-12': { end: '2021-09-16' }, // undocked on the 16th; LL2 has its landing, unlike every later crew's
	'iss/expedition-2': { start: '2001-03-10', end: '2001-08-20' }, // STS-102's docking and STS-105's undocking; LL2 has their launch and landing
	'iss/expedition-24': { start: '2010-06-02' }, // Soyuz TMA-17 undocked at 00:04 UTC on the 2nd; LL2 has the 1st, before Expedition 23 ended
	'iss/expedition-38': { end: '2014-03-11' }, // Soyuz TMA-10M undocked in March, as Expedition 39 began; LL2 has 2014-05-11
	//
	// An ISS Expedition ends when the departing Soyuz undocks. LL2 dates these five handovers by the change of
	// command a day or so before it, unlike all the others (the Soyuz's undocking: MS-12, MS-13, MS-16, MS-21, MS-23).
	'iss/expedition-60': { end: '2019-10-03' },
	'iss/expedition-61': { start: '2019-10-03', end: '2020-02-06' },
	'iss/expedition-62': { start: '2020-02-06' },
	'iss/expedition-64': { start: '2020-10-21' },
	//
	// Salyut 7's 1985 crews. LL2 splits EO-4's first stage in two so that its crew can leave apart, and leaves
	// Savinykh, who stayed on, out of the second. There were two stages, as spacefacts.de has them.
	'salyut-7/eo-4-1a': { name: 'EO-4-1', end: '1985-09-26', crew: ['vladimir-dzhanibekov', 'viktor-savinykh'] },
	'salyut-7/eo-4-1b': { remove: true },
	'salyut-7/eo-4-2': { crew: ['vladimir-vasyutin', 'aleksandr-aleksandrovich-volkov', 'viktor-savinykh'] },
	// LL2 gives EO-5 all of Soyuz T-15's flight, most of it at Mir (as Mir EO-1): this is its time aboard Salyut 7.
	'salyut-7/eo-5': { start: '1986-05-06', end: '1986-06-25' },
	//
	// LL2 lists each ISS Expedition's arrivals, but from 2020 leaves out the crews still aboard from the one
	// before (checked against Wikidata, which every write cross-checks). A crew list is the whole crew: the
	// first line LL2's, the rest those it left out.
	'iss/expedition-63': {
		end: '2020-10-21',
		crew: [
			'christopher-cassidy', 'anatoli-ivanishin', 'ivan-vagner', 'kathleen-rubins', 'sergey-ryzhikov', 'sergey-kud-sverchkov',
			'robert-l-behnken', 'douglas-g-hurley' // Demo-2
		]
	},
	'iss/expedition-65': {
		crew: [
			'oleg-novitskiy', 'pyotr-dubrov', 'mark-t-vande-hei', 'shane-kimbrough', 'megan-mcarthur', 'akihiko-hoshide', 'thomas-pesquet', 'anton-shkaplerov',
			'mike-hopkins', 'victor-glover', 'shannon-walker', 'soichi-noguchi' // Crew-1, still aboard
		]
	},
	'iss/expedition-66': {
		crew: [
			'anton-shkaplerov', 'mark-t-vande-hei', 'pyotr-dubrov', 'raja-chari', 'thomas-marshburn', 'kayla-barron', 'matthias-maurer', 'oleg-artemyev', 'denis-matveev', 'sergey-korsakov',
			'shane-kimbrough', 'megan-mcarthur', 'akihiko-hoshide', 'thomas-pesquet' // Crew-2, still aboard
		]
	},
	'iss/expedition-67': {
		end: '2022-09-29',
		crew: [
			'oleg-artemyev', 'denis-matveev', 'sergey-korsakov', 'kjell-lindgren', 'robert-hines', 'jessica-watkins', 'samantha-cristoforetti', 'sergey-prokopyev', 'dmitrij-petelin', 'francisco-rubio',
			'raja-chari', 'thomas-marshburn', 'kayla-barron', 'matthias-maurer' // Crew-3, still aboard
		]
	},
	'iss/expedition-68': {
		start: '2022-09-29',
		crew: [
			'sergey-prokopyev', 'dmitrij-petelin', 'francisco-rubio', 'stephen-bowen', 'warren-hoburg', 'sultan-al-niadi', 'andrey-fedyayev',
			'kjell-lindgren', 'robert-hines', 'jessica-watkins', 'samantha-cristoforetti', // Crew-4, still aboard
			'nicole-mann', 'josh-a-cassada', 'koichi-wakata', 'anna-kikina' // Crew-5
		]
	},
	'iss/expedition-69': {
		end: '2023-09-27',
		crew: [
			'sergey-prokopyev', 'dmitrij-petelin', 'francisco-rubio', 'jasmin-moghbeli', 'andreas-mogensen', 'satoshi-furukawa', 'konstantin-borisov', 'oleg-kononenko', 'nikolay-chub', 'loral-o-hara',
			'stephen-bowen', 'warren-hoburg', 'sultan-al-niadi', 'andrey-fedyayev' // Crew-6, still aboard
		]
	},
	'iss/expedition-70': {
		start: '2023-09-27',
		crew: [
			'oleg-kononenko', 'nikolay-chub', 'loral-o-hara', 'matthew-dominick', 'michael-barratt', 'jeanette-j-epps', 'alexander-grebenkin', 'tracy-caldwell-dyson',
			'jasmin-moghbeli', 'andreas-mogensen', 'satoshi-furukawa', 'konstantin-borisov' // Crew-7, still aboard
		]
	},
	'iss/expedition-72': {
		crew: [
			'donald-pettit', 'aleksey-ovchinin', 'ivan-vagner', // Soyuz MS-26
			'michael-barratt', 'matthew-dominick', 'jeanette-j-epps', 'alexander-grebenkin', // Crew-8, still aboard
			'sunita-williams', 'barry-e-wilmore', // up on Starliner's test flight, home with Crew-9
			'nick-hague', 'aleksandr-gorbunov', // Crew-9, flown with two seats empty to bring them home
			'anne-mcclain', 'nichole-ayers', 'takuya-onishi', 'kirill-peskov', // Crew-10
			'sergey-ryzhikov', 'alexey-zubritsky', 'jonny-kim' // Soyuz MS-27
		]
	},
	'iss/expedition-73': {
		crew: [
			'sergey-ryzhikov', 'alexey-zubritsky', 'jonny-kim', 'zena-cardman', 'michael-fincke', 'kimiya-yui', 'oleg-platonov', 'sergey-kud-sverchkov', 'sergei-mikayev', 'christopher-williams',
			'anne-mcclain', 'nichole-ayers', 'takuya-onishi', 'kirill-peskov' // Crew-10, still aboard
		]
	},
	'iss/expedition-74': {
		crew: [
			'sergey-kud-sverchkov', 'sergei-mikayev', 'christopher-williams', 'jessica-meir', 'jack-hathaway', 'sophie-adenot', 'andrey-fedyayev',
			'zena-cardman', 'michael-fincke', 'kimiya-yui', 'oleg-platonov', // Crew-11, still aboard
			'pyotr-dubrov', 'anna-kikina', 'anil-menon' // arrived before it ended; LL2 lists them only in Expedition 75
		]
	},
	'iss/expedition-75': {
		crew: [
			'pyotr-dubrov', 'anna-kikina', 'anil-menon', 'jessica-watkins', 'joshua-kutryk', 'luke-delaney', 'sergey-teteryatnikov',
			'jessica-meir', 'jack-hathaway', 'sophie-adenot', 'andrey-fedyayev' // still aboard from Expedition 74
		]
	}
};
