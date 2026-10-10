/**
 * The people dataset is written twice: astronauts.json is pretty-printed so each data refresh reads
 * as a clean per-field git diff, and astronauts.min.json is the identical compact copy the app
 * imports. Every script that rewrites the dataset goes through writeAstronauts so the two never drift —
 * and so every write checks the nationalities and brings the flags they need (scripts/flags.ts).
 */
import { COUNTRY_CODE } from '../src/lib/countries';
import type { Person } from '../src/lib/types';
import { syncFlags } from './flags';

const ROOT = new URL('..', import.meta.url);
export const DATA = new URL('src/lib/data/astronauts.json', ROOT);
export const DATA_MIN = new URL('src/lib/data/astronauts.min.json', ROOT);

export async function writeAstronauts(people: Person[]) {
	await Bun.write(DATA, JSON.stringify(people, null, 2) + '\n');
	await Bun.write(DATA_MIN, JSON.stringify(people));
	checkNationalities(people);
	await syncFlags(people);
}

/** Warn — never fail — about anyone with no nationality, or one src/lib/countries.ts doesn't know. */
function checkNationalities(people: Person[]) {
	const none = people.filter((p) => !p.nationalities?.length).map((p) => p.name);
	const unknown = new Map<string, string[]>();
	for (const p of people)
		for (const n of p.nationalities ?? []) if (!COUNTRY_CODE[n]) unknown.set(n, [...(unknown.get(n) ?? []), p.name]);
	if (none.length)
		console.warn(`  ⚠ no nationality yet — fine if a later step supplies it, else add to scripts/nationality.ts: ${none.join(', ')}`);
	for (const [n, who] of unknown) console.warn(`  ⚠ "${n}" isn't in src/lib/countries.ts (${who.join(', ')})`);
}
