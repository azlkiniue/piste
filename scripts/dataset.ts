/**
 * The people dataset is written twice: astronauts.json is pretty-printed so each data refresh reads
 * as a clean per-field git diff, and astronauts.min.json is the identical compact copy the app
 * imports. Every script that rewrites the dataset goes through writeAstronauts so the two never drift —
 * and so every write checks the nationalities, agencies and Stays, and brings the flags they need
 * (scripts/flags.ts). The station dataset (Stations' lifetimes and Expeditions, see scripts/stations.ts) is
 * written the same two ways by writeStations.
 */
import { AGENCIES } from '../src/lib/agencies';
import { COUNTRY_CODE } from '../src/lib/countries';
import { STATIONS } from '../src/lib/stations';
import type { Person, StationData } from '../src/lib/types';
import { undefinedKeys } from './agency';
import { syncFlags } from './flags';

const ROOT = new URL('..', import.meta.url);
export const DATA = new URL('src/lib/data/astronauts.json', ROOT);
export const DATA_MIN = new URL('src/lib/data/astronauts.min.json', ROOT);
export const STATION_DATA = new URL('src/lib/data/stations.json', ROOT);
export const STATION_DATA_MIN = new URL('src/lib/data/stations.min.json', ROOT);

/** A dataset date (dob/dod) as LL2 and Supercluster store it, for matching people across them: a date
 *  known only to the month or year is padded to its 1st there ("1975-10" → "1975-10-01", "1988" →
 *  "1988-01-01"). Compared for equality, not as a prefix — a year alone mustn't match every date in it. */
export const paddedDate = (d: string) => (d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d);

export async function writeAstronauts(people: Person[]) {
	await Bun.write(DATA, JSON.stringify(people, null, 2) + '\n');
	await Bun.write(DATA_MIN, JSON.stringify(people));
	checkNationalities(people);
	checkAgencies(people);
	if (await Bun.file(STATION_DATA).exists()) checkStays(people, await Bun.file(STATION_DATA).json());
	await syncFlags(people);
}

export async function writeStations(data: StationData) {
	await Bun.write(STATION_DATA, JSON.stringify(data, null, 2) + '\n');
	await Bun.write(STATION_DATA_MIN, JSON.stringify(data));
}

/** Warn — never fail — about Stays that look wrong against the station dataset: a long one in no Expedition
 *  (a crew list LL2 left someone off), an Expedition member aboard at none of its dates, and any Station or
 *  Expedition the registry or dataset doesn't know. Fix them with an Expedition correction (scripts/overrides.ts)
 *  or a researched list in scripts/stations.ts. */
function checkStays(people: Person[], { expeditions }: StationData) {
	const today = new Date().toISOString().slice(0, 10);
	const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
	const byKey = new Map(expeditions.map((x) => [`${x.station}/${x.slug}`, x]));
	const long: string[] = [];
	const outside: string[] = [];
	const unknown: string[] = [];
	for (const p of people)
		for (const f of p.flights)
			for (const s of f.stays ?? []) {
				const end = s.depart ?? today;
				const where = `${p.name} (${s.station}, ${s.arrive} → ${s.depart ?? 'now'})`;
				if (!STATIONS[s.station]) unknown.push(`Station "${s.station}" — ${where}`);
				if (!s.expeditions.length && days(s.arrive, end) >= 30) long.push(where);
				for (const slug of s.expeditions) {
					const x = byKey.get(`${s.station}/${slug}`);
					if (!x) unknown.push(`Expedition "${s.station}/${slug}" — ${where}`);
					else if (s.arrive > (x.end ?? today) || end < x.start) outside.push(`${where} in ${x.name} (${x.start} → ${x.end ?? 'now'})`);
				}
			}
	for (const x of expeditions) if (!STATIONS[x.station]) unknown.push(`Station "${x.station}" — Expedition ${x.name}`);
	if (long.length) console.warn(`  ⚠ Stays of 30+ days in no Expedition — a crew list missing them? ${long.join(', ')}`);
	if (outside.length) console.warn(`  ⚠ Expedition crew aboard at none of its dates: ${outside.join(', ')}`);
	for (const u of unknown) console.warn(`  ⚠ unknown ${u}`);
}

/** Warn — never fail — about anyone with no agency, or one src/lib/agencies.ts doesn't know. */
function checkAgencies(people: Person[]) {
	const none = people.filter((p) => !p.agencies?.length).map((p) => p.name);
	const unknown = new Map<string, string[]>();
	for (const p of people) for (const a of p.agencies ?? []) if (!AGENCIES[a]) unknown.set(a, [...(unknown.get(a) ?? []), p.name]);
	if (none.length) console.warn(`  ⚠ no agency yet — fine if a later step supplies it, else add to scripts/agency.ts: ${none.join(', ')}`);
	for (const [a, who] of unknown) console.warn(`  ⚠ agency "${a}" isn't in src/lib/agencies.ts (${who.join(', ')})`);
	for (const a of undefinedKeys()) console.warn(`  ⚠ scripts/agency.ts names "${a}", which src/lib/agencies.ts doesn't define`);
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
