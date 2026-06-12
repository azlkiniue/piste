import type { Person } from './types';
import { valueOf, type ColorBy } from './colors';

export type SortKey = 'firstLaunch' | 'name' | 'days' | 'flights';
export type FlightType = 'all' | 'orbital' | 'suborbital';
export type Dim = 'nationality' | 'agency' | 'gender' | 'status';

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
	{ id: 'firstLaunch', label: 'First flight' },
	{ id: 'name', label: 'Name' },
	{ id: 'days', label: 'Time in space' },
	{ id: 'flights', label: 'Flight count' }
];

/** Reactive filter/sort/colour state for the whole app. */
export class Filters {
	search = $state('');
	nationalities = $state(new Set<string>());
	agencies = $state(new Set<string>());
	genders = $state(new Set<string>());
	statuses = $state(new Set<string>());
	flightType = $state<FlightType>('all');
	sort = $state<SortKey>('firstLaunch');
	colorBy = $state<ColorBy>('nationality');

	setOf(dim: Dim): Set<string> {
		return dim === 'nationality'
			? this.nationalities
			: dim === 'agency'
				? this.agencies
				: dim === 'gender'
					? this.genders
					: this.statuses;
	}

	toggle(dim: Dim, v: string) {
		const next = new Set(this.setOf(dim));
		next.has(v) ? next.delete(v) : next.add(v);
		if (dim === 'nationality') this.nationalities = next;
		else if (dim === 'agency') this.agencies = next;
		else if (dim === 'gender') this.genders = next;
		else this.statuses = next;
	}

	get activeCount(): number {
		return (
			this.nationalities.size +
			this.agencies.size +
			this.genders.size +
			this.statuses.size +
			(this.flightType !== 'all' ? 1 : 0) +
			(this.search.trim() ? 1 : 0)
		);
	}

	reset() {
		this.search = '';
		this.nationalities = new Set();
		this.agencies = new Set();
		this.genders = new Set();
		this.statuses = new Set();
		this.flightType = 'all';
	}
}

/** True if person passes every active filter (optionally ignoring one dimension, for facet counts). */
export function matches(p: Person, f: Filters, skip?: Dim | 'flightType'): boolean {
	const q = f.search.trim().toLowerCase();
	if (q && !p.name.toLowerCase().includes(q)) return false;
	if (skip !== 'nationality' && f.nationalities.size && !f.nationalities.has(p.nationality)) return false;
	if (skip !== 'agency' && f.agencies.size && !f.agencies.has(p.agency)) return false;
	if (skip !== 'gender' && f.genders.size && !f.genders.has(p.gender)) return false;
	if (skip !== 'status' && f.statuses.size && !f.statuses.has(p.status)) return false;
	if (skip !== 'flightType') {
		if (f.flightType === 'orbital' && !p.flights.some((x) => x.orbital)) return false;
		if (f.flightType === 'suborbital' && !p.flights.some((x) => !x.orbital)) return false;
	}
	return true;
}

const SORTERS: Record<SortKey, (a: Person, b: Person) => number> = {
	firstLaunch: (a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name),
	name: (a, b) => a.name.localeCompare(b.name),
	days: (a, b) => b.totalDaysInSpace - a.totalDaysInSpace || a.firstLaunch.localeCompare(b.firstLaunch),
	flights: (a, b) => b.flights.length - a.flights.length || a.firstLaunch.localeCompare(b.firstLaunch)
};

export function applyFilters(people: Person[], f: Filters): Person[] {
	return people.filter((p) => matches(p, f)).sort(SORTERS[f.sort]);
}

/** Count people per value of `dim`, honouring all other active filters. */
export function facetCounts(people: Person[], f: Filters, dim: Dim): Map<string, number> {
	const m = new Map<string, number>();
	for (const p of people) {
		if (!matches(p, f, dim)) continue;
		const v = valueOf(p, dim);
		m.set(v, (m.get(v) ?? 0) + 1);
	}
	return m;
}
