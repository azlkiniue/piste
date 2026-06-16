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
	// 'yuri-gagarin': { agency: 'Roscosmos', image: 'https://example.com/gagarin.jpg' },
	// 'Q7327':        { nationality: 'Russia', countryCode: 'ru' },
	// 'll2-690':      { agency: '' }, // emptied → agency reverts to whatever the pipeline set
	//
	// Overriding `flights` replaces the whole array; firstLaunch / lastLanding / totalDaysInSpace /
	// status are then recomputed from it automatically (unless you set those explicitly too):
	// 'some-slug': {
	// 	flights: [
	// 		{ mission: 'Vostok 1', launch: '1961-04-12', landing: '1961-04-12', ongoing: false, orbital: true, approx: false }
	// 	]
	// }
};
