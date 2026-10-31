/**
 * Station history, checked against the committed data the app reads (src/lib/data/). These test what the
 * pages will show — known facts and rules every record must keep — not how the pipeline gets there, so
 * they run after any rebuild: `bun test`.
 */
import { describe, expect, test } from 'bun:test';
import people from '../src/lib/data/astronauts.min.json';
import stationData from '../src/lib/data/stations.min.json';
import { STATIONS } from '../src/lib/stations';
import type { Flight, Person, StationData, Stay } from '../src/lib/types';

const all = people as Person[];
const { stations, expeditions } = stationData as StationData;
const today = new Date().toISOString().slice(0, 10);

const person = (slug: string) => {
	const p = all.find((x) => x.slug === slug);
	if (!p) throw new Error(`no person ${slug}`);
	return p;
};
const staysOf = (p: Person) => p.flights.flatMap((f) => (f.stays ?? []).map((s) => ({ ...s, flight: f })));
/** The person's Stay aboard a Station that began in a given year (or on a given date prefix). */
const stayIn = (slug: string, station: string, when: string) => {
	const s = staysOf(person(slug)).find((s) => s.station === station && s.arrive.startsWith(when));
	if (!s) throw new Error(`${slug} has no ${station} Stay in ${when}`);
	return s;
};
const isVisitor = (s: Stay) => s.expeditions.length === 0;

describe('every record', () => {
	const every = all.flatMap((p) => p.flights.flatMap((f) => (f.stays ?? []).map((s) => ({ p, f, s }))));

	test('there are Stays to check', () => {
		expect(every.length).toBeGreaterThan(500);
	});

	test("each Stay falls within its flight's dates", () => {
		const end = (f: Flight) => f.landing ?? today;
		const bad = every.filter(({ f, s }) => s.arrive < f.launch || (s.depart ?? today) > end(f) || s.arrive > (s.depart ?? today));
		expect(bad.map(({ p, s }) => `${p.name} ${s.station} ${s.arrive}`)).toEqual([]);
	});

	test("one person's Stays never overlap", () => {
		const bad: string[] = [];
		for (const p of all) {
			const stays = staysOf(p).sort((a, b) => a.arrive.localeCompare(b.arrive));
			for (let i = 1; i < stays.length; i++)
				if (stays[i].arrive < (stays[i - 1].depart ?? today)) bad.push(`${p.name} ${stays[i].station} ${stays[i].arrive}`);
		}
		expect(bad).toEqual([]);
	});

	test('each Stay names a Station in the registry', () => {
		expect(every.filter(({ s }) => !STATIONS[s.station]).map(({ s }) => s.station)).toEqual([]);
	});

	test('each Expedition a Stay names exists, on that Station', () => {
		const known = new Set(expeditions.map((x) => `${x.station}/${x.slug}`));
		const bad = every.flatMap(({ p, s }) => s.expeditions.filter((x) => !known.has(`${s.station}/${x}`)).map((x) => `${p.name} ${s.station}/${x}`));
		expect(bad).toEqual([]);
	});

	test('each Expedition has at least one Stay', () => {
		const named = new Set(every.flatMap(({ s }) => s.expeditions.map((x) => `${s.station}/${x}`)));
		expect(expeditions.map((x) => `${x.station}/${x.slug}`).filter((k) => !named.has(k))).toEqual([]);
	});

	test('only an ongoing flight has an ongoing Stay, and an ongoing Stay has no departure', () => {
		expect(every.filter(({ f, s }) => (s.ongoing && !f.ongoing) || s.ongoing !== (s.depart === null)).map(({ p }) => p.name)).toEqual([]);
	});

	test("Expedition slugs are unique within their Station", () => {
		const keys = expeditions.map((x) => `${x.station}/${x.slug}`);
		expect(keys.length).toBe(new Set(keys).size);
	});

	test('the station dataset covers exactly the twelve Stations in the registry, in order', () => {
		expect(Object.keys(STATIONS)).toHaveLength(12);
		expect(stations.map((s) => s.slug)).toEqual(Object.keys(STATIONS));
	});
});

describe('known history', () => {
	test("Soyuz T-15's flight makes three Stays: Mir, Salyut 7, then Mir", () => {
		for (const slug of ['leonid-kizim', 'vladimir-solovyov']) {
			const t15 = person(slug).flights.find((f) => f.mission === 'Soyuz T-15')!;
			expect(t15.stays?.map((s) => s.station)).toEqual(['mir', 'salyut-7', 'mir']);
		}
	});

	test("both of Kizim's Mir Stays on T-15 are Mir EO-1", () => {
		const t15 = person('leonid-kizim').flights.find((f) => f.mission === 'Soyuz T-15')!;
		expect(t15.stays?.filter((s) => s.station === 'mir').map((s) => s.expeditions)).toEqual([['eo-1'], ['eo-1']]);
	});

	test("Pesquet's 2016–17 Stay belongs to Expeditions 50 and 51", () => {
		expect(stayIn('thomas-pesquet', 'iss', '2016').expeditions).toEqual(['expedition-50', 'expedition-51']);
	});

	test("Salyut 1's only Expedition is Soyuz 11's crew", () => {
		const salyut1 = expeditions.filter((x) => x.station === 'salyut-1');
		expect(salyut1.map((x) => x.name)).toEqual(['Soyuz 11']);
		for (const slug of ['georgy-dobrovolsky', 'vladislav-volkov', 'viktor-patsayev'])
			expect(stayIn(slug, 'salyut-1', '1971').expeditions).toEqual(['soyuz-11']);
	});

	test("Soyuz 10's crew, who docked to Salyut 1 but never went aboard, have no Stay there", () => {
		for (const slug of ['vladimir-shatalov', 'aleksei-yeliseyev', 'nikolay-rukavishnikov'])
			expect(staysOf(person(slug)).filter((s) => s.station === 'salyut-1')).toEqual([]);
	});

	test("Shenzhou 9's crew are Expedition crew on Tiangong-1", () => {
		for (const slug of ['jing-haipeng', 'liu-wang', 'liu-yang'])
			expect(stayIn(slug, 'tiangong-1', '2012').expeditions).toEqual(['shenzhou-9']);
	});

	test('on STS-71, Solovyev and Budarin are Mir EO-19 crew, while the other five on Atlantis are Visitors', () => {
		expect(stayIn('nikolai-budarin', 'mir', '1995').expeditions).toEqual(['eo-19']);
		expect(stayIn('anatoly-yakovlevich-solovyev', 'mir', '1995').expeditions).toEqual(['eo-19']);
		for (const slug of ['robert-l-gibson', 'charles-j-precourt', 'ellen-s-baker', 'gregory-j-harbaugh', 'bonnie-j-dunbar'])
			expect(isVisitor(stayIn(slug, 'mir', '1995-06'))).toBe(true);
	});

	test("Scott Kelly is a Visitor on STS-118 and Expedition crew in 2015–16", () => {
		expect(isVisitor(stayIn('scott-kelly', 'iss', '2007'))).toBe(true);
		expect(stayIn('scott-kelly', 'iss', '2015').expeditions).toContain('expedition-46');
	});

	test('guest crews and guests are Visitors', () => {
		const visits: [string, string, string][] = [
			['michael-lopez-alegria', 'iss', '2022'], // Ax-1
			['larry-connor', 'iss', '2022'],
			['mark-pathy', 'iss', '2022'],
			['eytan-stibbe', 'iss', '2022'],
			['yusaku-maezawa', 'iss', '2021'], // Soyuz MS-20
			['yulia-peresild', 'iss', '2021'], // the "Challenge" film crew
			['klim-shipenko', 'iss', '2021'],
			['jugderdemidiin-gurragchaa', 'salyut-6', '1981'], // Interkosmos
			['vladimir-remek', 'salyut-6', '1978'],
			['ulf-merbold', 'mir', '1994'], // Euromir 94
			['ivan-bella', 'mir', '1999'], // listed in Mir EO-27's crew
			['marina-vasilevskaya', 'iss', '2024'] // listed in Expedition 70's crew
		];
		expect(visits.filter(([slug, station, when]) => !isVisitor(stayIn(slug, station, when))).map(([slug]) => slug)).toEqual([]);
	});
});
