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
import type { Expedition, Person } from '../src/lib/types';

/** A subset of Person fields. The extra `'' | null` lets you "empty" a field to revert it. */
export type Override = { [K in keyof Person]?: Person[K] | '' | null };

/** Expedition fields you can correct, plus `crew`: the slugs of everyone in it. Setting `crew` replaces the
 *  Expedition's membership — it's added to those people's Stays aboard the Station during it, and taken off
 *  anyone else's. `'' | null | []` empties a field to revert it, as for people. */
export type ExpeditionOverride = {
	[K in 'start' | 'end' | 'name' | 'station']?: Expedition[K] | '' | null;
} & { crew?: string[] };

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
	'toyohiro-akiyama': { agencies: ['CCCP'] }, // was Roscosmos — in 1990 that was the Soviet programme
	'alan-shepard': {flights: [{"mission":"Mercury-Redstone 3","launch":"1961-05-05","landing":"1961-05-05","ongoing":false,"orbital":false,"approx":false},{"mission":"Apollo 14","launch":"1971-01-31","landing":"1971-02-09","ongoing":false,"orbital":true,"approx":false}]},
};

/**
 * Expedition corrections, applied by enrich-manual the same way: a value wins, an emptied one reverts.
 * Key each by `<station>/<expedition>` — slugs from src/lib/data/stations.json, since names repeat across
 * Stations (EO-1 is Salyut 6's, Salyut 7's and Mir's). A person's Stays themselves are corrected through
 * their `flights` above, which replaces the Stays with the flights.
 */
export const expeditionOverrides: Record<string, ExpeditionOverride> = {
	// ───────── example ─────────
	// 'mir/eo-27': { end: '1999-08-28', crew: ['viktor-afanasyev', 'jean-pierre-haignere', 'sergei-avdeyev'] },
	//
	// LL2 lists each ISS Expedition's arrivals, but from 2020 leaves out the crews still aboard from the one
	// before (checked against Wikidata, which every write cross-checks). A crew list is the whole crew: the
	// first line LL2's, the rest those it left out.
	'iss/expedition-63': {
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
		crew: [
			'oleg-artemyev', 'denis-matveev', 'sergey-korsakov', 'kjell-lindgren', 'robert-hines', 'jessica-watkins', 'samantha-cristoforetti', 'sergey-prokopyev', 'dmitrij-petelin', 'francisco-rubio',
			'raja-chari', 'thomas-marshburn', 'kayla-barron', 'matthias-maurer' // Crew-3, still aboard
		]
	},
	'iss/expedition-68': {
		crew: [
			'sergey-prokopyev', 'dmitrij-petelin', 'francisco-rubio', 'stephen-bowen', 'warren-hoburg', 'sultan-al-niadi', 'andrey-fedyayev',
			'kjell-lindgren', 'robert-hines', 'jessica-watkins', 'samantha-cristoforetti', // Crew-4, still aboard
			'nicole-mann', 'josh-a-cassada', 'koichi-wakata', 'anna-kikina' // Crew-5
		]
	},
	'iss/expedition-69': {
		crew: [
			'sergey-prokopyev', 'dmitrij-petelin', 'francisco-rubio', 'jasmin-moghbeli', 'andreas-mogensen', 'satoshi-furukawa', 'konstantin-borisov', 'oleg-kononenko', 'nikolay-chub', 'loral-o-hara',
			'stephen-bowen', 'warren-hoburg', 'sultan-al-niadi', 'andrey-fedyayev' // Crew-6, still aboard
		]
	},
	'iss/expedition-70': {
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
