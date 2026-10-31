// Lookups the station pages share: the Stays aboard each Station, and each Expedition's crew. Stays live on
// people's Flights (docs/adr/0002), so both are built by scanning the people dataset once.
import type { Flight, Person, Stay } from './types';

export interface StayRow {
	person: Person;
	flight: Flight;
	stay: Stay;
}

/** `station/slug` — Expedition slugs are unique only within their Station (EO-1 is Salyut 6's, 7's and Mir's). */
export const expeditionKey = (station: string, slug: string) => `${station}/${slug}`;

/** Every Stay aboard each Station, in arrival order. */
export function staysByStation(people: Person[]): Map<string, StayRow[]> {
	const out = new Map<string, StayRow[]>();
	for (const person of people)
		for (const flight of person.flights)
			for (const stay of flight.stays ?? []) {
				const rows = out.get(stay.station) ?? [];
				rows.push({ person, flight, stay });
				out.set(stay.station, rows);
			}
	for (const rows of out.values()) rows.sort((a, b) => a.stay.arrive.localeCompare(b.stay.arrive) || a.person.name.localeCompare(b.person.name));
	return out;
}

/** Each Expedition's crew — the Stays that name it, in arrival order — keyed by expeditionKey. */
export function crewByExpedition(byStation: Map<string, StayRow[]>): Map<string, StayRow[]> {
	const out = new Map<string, StayRow[]>();
	for (const [station, rows] of byStation)
		for (const row of rows)
			for (const slug of row.stay.expeditions) {
				const key = expeditionKey(station, slug);
				out.set(key, [...(out.get(key) ?? []), row]);
			}
	return out;
}

/** A date's milliseconds, with an open end (ongoing) running to now. */
export const endMs = (iso: string | null) => (iso ? Date.parse(iso) : Date.now());
