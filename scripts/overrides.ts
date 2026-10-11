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
import type { Person } from '../src/lib/types';

/** A subset of Person fields. The extra `'' | null` lets you "empty" a field to revert it. */
export type Override = { [K in keyof Person]?: Person[K] | '' | null };

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
