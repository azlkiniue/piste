/**
 * Flight history, checked against the committed data the app reads (src/lib/data/), as station-data.test.ts
 * checks the Stations': known facts and rules every record must keep. `bun test` runs both.
 */
import { describe, expect, test } from 'bun:test';
import people from '../src/lib/data/astronauts.min.json';
import type { Person } from '../src/lib/types';
import { neverReachedSpace } from './spaceflight';

const all = people as Person[];

const person = (slug: string) => {
	const p = all.find((x) => x.slug === slug);
	if (!p) throw new Error(`no person ${slug}`);
	return p;
};
/** The landing of every Flight of a Mission, by person. */
const landings = (mission: string) =>
	Object.fromEntries(all.flatMap((p) => p.flights.filter((f) => f.mission === mission).map((f) => [p.slug, f.landing])));

describe('every record', () => {
	// The pipeline had Apollo 17 (Cernan's record) and STS-3 land on launch day.
	test('an orbital flight lands after its launch day, unless it orbited for less than a day', () => {
		const sameDay = new Set(['Vostok 1', 'Mercury-Atlas 6', 'Mercury-Atlas 7', 'Mercury-Atlas 8', 'Gemini III', 'Gemini 3', 'Shenzhou-5']);
		const bad = all.flatMap((p) =>
			p.flights.filter((f) => f.orbital && !f.ongoing && f.landing === f.launch && !sameDay.has(f.mission)).map((f) => `${p.name} ${f.mission}`)
		);
		expect(bad).toEqual([]);
	});

	test("a person's last landing is their latest flight's, or none while they're in space", () => {
		const latest = (p: Person) =>
			p.flights.some((f) => f.ongoing) ? null : (p.flights.map((f) => f.landing).filter((d): d is string => !!d).sort().at(-1) ?? null);
		expect(all.filter((p) => p.lastLanding !== latest(p)).map((p) => `${p.name} ${p.lastLanding}`)).toEqual([]);
	});

	test("a person's first launch is their earliest flight's", () => {
		expect(all.filter((p) => p.firstLaunch !== p.flights.map((f) => f.launch).sort()[0]).map((p) => `${p.name} ${p.firstLaunch}`)).toEqual([]);
	});

	test('no launch that never reached space (scripts/spaceflight.ts) is counted as a flight', () => {
		expect(all.flatMap((p) => p.flights.filter((f) => neverReachedSpace(f.mission)).map((f) => `${p.name} ${f.mission}`))).toEqual([]);
	});
});

describe('known history', () => {
	// Landings from the missions' records (UTC); the pipeline has these wrong, `flightOverrides` corrects them.
	test('Apollo 17 landed on 19 December 1972, with all three of its crew', () => {
		expect(landings('Apollo 17')).toEqual({ 'eugene-cernan': '1972-12-19', 'ronald-evans': '1972-12-19', 'harrison-schmitt': '1972-12-19' });
	});

	test('STS-3 landed on 30 March 1982', () => {
		expect(landings('STS-3')).toEqual({ 'jack-r-lousma': '1982-03-30', 'c-gordon-fullerton': '1982-03-30' });
	});

	test('STS-44 landed on 1 December 1991, at 22:34 UTC', () => {
		expect(new Set(Object.values(landings('STS-44')))).toEqual(new Set(['1991-12-01']));
		expect(Object.keys(landings('STS-44'))).toHaveLength(6);
	});

	test('Inspiration4 splashed down on 18 September 2021, at 23:06 UTC', () => {
		expect(new Set(Object.values(landings('Inspiration4')))).toEqual(new Set(['2021-09-18']));
		expect(Object.keys(landings('Inspiration4'))).toHaveLength(4);
	});

	test("VSS Unity 24, a glide test, is no one's spaceflight: Pecile first flew to space on Galactic 01", () => {
		expect(all.filter((p) => p.flights.some((f) => f.mission === 'VSS Unity 24')).map((p) => p.name)).toEqual([]);
		expect(person('nicola-pecile').firstLaunch).toBe('2023-06-29');
		expect(person('frederick-w-sturckow').flights).toHaveLength(10);
	});

	// Whole days in space, as LL2 counts them: Fullerton's 15 days 22 hours is 15. Checked against Spacefacts.
	test('the days in space of everyone on those flights', () => {
		const slugs = ['eugene-cernan', 'jack-r-lousma', 'c-gordon-fullerton', 'story-musgrave', 'frederick-d-gregory', 'james-s-voss', 'mario-runco-jr', 'terence-t-henricks', 'thomas-j-hennen', 'jared-isaacman', 'sian-proctor', 'hayley-arceneaux', 'christopher-sembroski'];
		expect(Object.fromEntries(slugs.map((s) => [s, person(s).totalDaysInSpace]))).toEqual({
			'eugene-cernan': 23,
			'jack-r-lousma': 67,
			'c-gordon-fullerton': 15,
			'story-musgrave': 53,
			'frederick-d-gregory': 18,
			'james-s-voss': 202,
			'mario-runco-jr': 22,
			'terence-t-henricks': 42,
			'thomas-j-hennen': 6,
			'jared-isaacman': 7,
			'sian-proctor': 2,
			'hayley-arceneaux': 2,
			'christopher-sembroski': 2
		});
	});
});
