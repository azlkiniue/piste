/**
 * The people dataset is written twice: astronauts.json is pretty-printed so each data refresh reads
 * as a clean per-field git diff, and astronauts.min.json is the identical compact copy the app
 * imports. Every script that rewrites the dataset goes through writeAstronauts so the two never drift.
 */
import type { Person } from '../src/lib/types';

const ROOT = new URL('..', import.meta.url);
export const DATA = new URL('src/lib/data/astronauts.json', ROOT);
export const DATA_MIN = new URL('src/lib/data/astronauts.min.json', ROOT);

export async function writeAstronauts(people: Person[]) {
	await Bun.write(DATA, JSON.stringify(people, null, 2) + '\n');
	await Bun.write(DATA_MIN, JSON.stringify(people));
}
