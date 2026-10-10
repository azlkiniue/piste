/**
 * How a person's nationalities are decided. Every layer that derives them from a source — update-data
 * (Wikidata), enrich-ll2 and enrich-supercluster — maps its source's vocabulary onto the country names in
 * src/lib/countries.ts, then passes the person through settleNationalities, which fixes what no source
 * gets right on its own. (Manual overrides still have the last word: enrich-manual doesn't call it.)
 *
 * A nationality is a state the person flew for, plus any other citizenship they held when they flew —
 * primary first:
 *
 *  - FORMER STATES — a flight counts for the state as it stood that day, so the dates override the
 *    sources' present-day country (LL2 often goes by birthplace: Popovich → Ukraine). Gagarin flew for
 *    the Soviet Union; Krikalev, aloft as it dissolved and flying again in 1994, for it and Russia;
 *    Merbold for West Germany in 1983, then for reunified Germany. East Germany can't be told apart by
 *    date — West Germans flew in the same years — so Jähn is listed under RESEARCHED instead.
 *  - RESEARCHED — people every source gets wrong or incomplete, checked one by one against Wikipedia's
 *    "List of space travelers by nationality" (which records nationality at the time of flight), the
 *    mission crew records and each person's own article. Heritage alone ("Italian-American") doesn't
 *    count, nor does a citizenship gained after flying. Order follows the sources, additions last.
 */
import type { Person } from '../src/lib/types';

interface Former {
	state: string;
	/** The day it gave way to its successors (ISO) — a flight before it counts for the former state. */
	end: string;
	successors: string[];
	/** Continuator state, assumed for a later flight when no successor is listed. */
	heir?: string;
}
const FORMER: Former[] = [
	{
		state: 'Soviet Union',
		end: '1991-12-26',
		heir: 'Russia',
		successors: ['Russia', 'Ukraine', 'Belarus', 'Kazakhstan', 'Uzbekistan', 'Kyrgyzstan', 'Tajikistan', 'Turkmenistan',
			'Azerbaijan', 'Armenia', 'Georgia', 'Moldova', 'Lithuania', 'Latvia', 'Estonia']
	},
	{ state: 'Czechoslovakia', end: '1993-01-01', successors: ['Czechia', 'Slovakia'] },
	{ state: 'West Germany', end: '1990-10-03', heir: 'Germany', successors: ['Germany'] } // reunification
];

const RESEARCHED: Record<string, string[]> = {
	'Sigmund Jähn': ['East Germany'], // flew for the GDR (Soyuz 31, 1978)
	'Toktar Aubakirov': ['Soviet Union'], // flew Oct 1991; Wikidata's dates are his Soyuz's, which landed in 1992
	'Abdul Ahad Mohmand': ['Afghanistan'], // German citizen only since 2003, after his 1988 flight
	'Eugene H. Trinh': ['United States'], // Vietnamese-born; a naturalized American when he flew
	'Piers Sellers': ['United States', 'United Kingdom'], // British-born, naturalized American in 1991
	'Jessica Meir': ['United States', 'Sweden'], // Swedish through her mother: the first Swedish woman in space
	'Marcus Wandt': ['Sweden', 'Norway'], // also Norwegian: the first Norwegian citizen in space
	'Andrew J. Feustel': ['United States', 'Canada'], // naturalized Canadian
	'Anousheh Ansari': ['Iran', 'United States'], // Iranian-born naturalized American
	'Charles Simonyi': ['Hungary', 'United States'], // American since 1982, still Hungarian
	'Chun Wang': ['Malta', 'Saint Kitts and Nevis'], // citizen of both (2023, 2017); China is only his birthplace
	'Justin Sun': ['Saint Kitts and Nevis'], // Chinese-born Kittitian citizen
	"Vanessa O'Brien": ['United States', 'United Kingdom'], // dual national (flew the British flag)
	'Colin Bennett': ['United Kingdom'], // British Virgin Galactic instructor
	'Gopi Thotakura': ['India'], // India's first space tourist
	'Eugene Grin': ['Ukraine', 'United States'], // flew the Ukrainian flag; American since emigrating in 1979
	'Russel Wilson': ['Australia'], // Australian (CoinSpot founder)
	'Freddie Rescigno Jr.': ['United States'], // Italian-American heritage, flew as an American
	'Owolabi Salis': ['Nigeria'], // the first Nigerian in space; US-based, not a US citizen
	'Arvi Bahal': ['United States'], // naturalized American (India allows no dual citizenship)
	'Adonis Pouroulis': ['South Africa'],
	'Hans Koenigsmann': ['Germany', 'United States'] // German-American, flew both flags
};

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const researched = new Map(Object.entries(RESEARCHED).map(([name, nats]) => [normName(name), nats]));

/** A person's settled nationalities: a researched entry if there is one, else the given ones with each
 *  former state put in for the flights before its end. */
export function settleNationalities(p: Pick<Person, 'name' | 'nationalities' | 'flights'>): string[] {
	const fix = researched.get(normName(p.name));
	if (fix) return [...fix];
	let nats = p.nationalities;
	for (const d of FORMER) {
		if (!nats.some((n) => n === d.state || d.successors.includes(n))) continue;
		const before = p.flights.some((f) => f.launch < d.end);
		const after = p.flights.some((f) => f.ongoing || (f.landing ?? f.launch) >= d.end);
		let rest = nats.filter((n) => n !== d.state && (after || !d.successors.includes(n)));
		if (after && d.heir && !rest.some((n) => d.successors.includes(n))) rest = [d.heir, ...rest];
		nats = before ? [d.state, ...rest] : rest;
	}
	return [...new Set(nats)];
}

/** RESEARCHED names that match nobody — renamed upstream, so the entry needs updating. */
export function unmatchedResearched(people: Pick<Person, 'name'>[]): string[] {
	const names = new Set(people.map((p) => normName(p.name)));
	return Object.keys(RESEARCHED).filter((name) => !names.has(normName(name)));
}
