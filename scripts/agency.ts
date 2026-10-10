/**
 * How a person's agencies are decided. Every layer that derives them from a source — update-data
 * (Wikidata), enrich-ll2 and enrich-supercluster — maps its source's labels onto the keys in
 * src/lib/agencies.ts with agencyOf, then passes the person through settleAgencies, which turns the
 * sources' present-day affiliation into the history of who the person flew for. (Manual overrides still
 * have the last word: enrich-manual doesn't call it.)
 *
 * `agencies` lists every agency a person flew for, oldest first, as it was when they flew:
 *
 *  - SUCCESSION — an agency that replaced another counts only for the flights after it existed; earlier
 *    flights count for its predecessor. So Wakata flew for NASDA in 1996 and 2000 and for JAXA from 2009;
 *    Krikalev for the Soviet programme (CCCP), then Roscosmos — in orbit as one gave way to the other, his
 *    1991–92 flight counts for both; Garneau for Canada's NRC in 1984, then the CSA. The sources only know
 *    the present-day agency, and Supercluster names the one that *selected* someone (NASDA for Hoshide,
 *    who first flew in 2008), so the flight dates decide either way.
 *  - COMMERCIAL MISSIONS — a flight a company ran counts for it (Axiom Space, Virgin Galactic, Blue
 *    Origin, SpaceX's private flights), beside the agency that bought the seat, if any: Shukla flew Ax-4
 *    for ISRO and Axiom Space. A company that only provides the ride to an agency's own mission doesn't
 *    count — NASA's Crew Dragon and Starliner crews flew for NASA, not SpaceX or Boeing.
 *  - RESEARCHED — people the rules and sources get wrong or incomplete, checked one by one against
 *    their Wikipedia articles, ESA's history of the European astronaut corps and mission records.
 *
 * Who counts: a government astronaut flies for the agency (or armed force) that employed them then; a
 * guest on another country's spacecraft for their own agency or programme, not the host's (a JAXA
 * astronaut on the Shuttle is JAXA; Soviet bloc guests flew under Interkosmos); a paying customer for the
 * company that ran or sold the flight (Space Adventures for the Soyuz tourists). Payload specialists on
 * NASA's science missions flew for NASA whoever employed them; those on Defense Department missions, for
 * their armed service.
 */
import { AGENCIES } from '../src/lib/agencies';
import type { Flight, Person } from '../src/lib/types';

// ---------------------------------------------------------------- source labels
// Any source's agency label → a key in src/lib/agencies.ts. Order matters (first match wins): Supercluster
// calls the Italian Space Agency "ISA", so it's matched before the Israel Space Agency.
const RULES: [RegExp, string][] = [
	[/Space Adventures/i, 'Space Adventures'],
	[/Scaled Composites/i, 'Scaled Composites'],
	[/\bNASA\b|National Aeronautics and Space Administration/i, 'NASA'],
	[/\bNASDA\b|National Space Development Agency of Japan/i, 'NASDA'],
	[/\bJAXA\b|Japan Aerospace Exploration/i, 'JAXA'],
	[/^CCCP$|Soviet space program|Soviet Air Forces/i, 'CCCP'],
	[/Roscosmos|Russian Federal Space|Russian Space Agency|\bRKA\b|Rosaviakosmos|Gagarin Cosmonaut/i, 'Roscosmos'],
	[/Interkosmos|Intercosmos/i, 'Interkosmos'],
	[/European Space Agency|\bESA\b/i, 'ESA'],
	[/\bCNES\b|National Cent(?:re|er) (?:for|of) Space/i, 'CNES'],
	[/\bDLR\b|\bDFVLR\b|German Aerospace Center|Luft- und Raumfahrt/i, 'DLR'],
	[/\bASI\b|Italian Space Agency|Agenzia Spaziale Italiana/i, 'ASI'],
	[/Italian Air Force|Aeronautica Militare/i, 'Italian Air Force'],
	[/Canadian Space Agency|\bCSA\b|Agence spatiale canadienne/i, 'CSA'],
	[/China Manned Space|China National Space|\bCNSA\b|\bCMSA?\b|People's Liberation Army/i, 'CMSA'],
	[/Indian Space Research|\bISRO\b/i, 'ISRO'],
	[/Israeli? Space Agency/i, 'ISA'],
	[/Brazilian Space Agency|\bAEB\b/i, 'AEB'],
	[/Malaysian National Space Agency|\bANGKASA\b/i, 'ANGKASA'],
	[/Korean Astronaut Program/i, 'KAP'],
	[/KazCosmos|National Space Agency of the Republic of Kazakhstan/i, 'KazCosmos'],
	[/Space Agency of Ukraine|\bN?SSAU\b|\bNSAU\b/i, 'SSAU'],
	[/Mohammed bin Rashid|\bMBRSC\b/i, 'MBRSC'],
	[/Saudi Space (?:Agency|Commission)/i, 'SSA'],
	[/Turkish Space Agency|\bTUA\b/i, 'TUA'],
	// LL2 files Tuva Atasever, Türkiye's second astronaut, under Turkmenistan's agency — a slip for Turkey's.
	[/Turkmenistan National Space Agency/i, 'TUA'],
	[/Hungarian Ministry of Foreign Affairs|\bHUNOR\b/i, 'HUNOR'],
	[/Austrian Space Agency/i, 'ASA'],
	[/Belarus(?:ian)? Space Agency/i, 'BSA'],
	[/Project Juno/i, 'Project Juno'],
	[/\bARABSAT\b|Arab Satellite Communications/i, 'ARABSAT'],
	[/United States Air Force|\bUSAF\b/i, 'USAF'],
	[/SpaceX|Space Exploration Technologies/i, 'SpaceX'],
	[/Blue Origin/i, 'Blue Origin'],
	[/Virgin Galactic/i, 'Virgin Galactic'],
	[/Axiom/i, 'Axiom Space']
];
/** The armed forces among the keys. Plenty of NASA and ESA astronauts served in one while they flew, so a
 *  Wikidata employer alone never makes one someone's agency — only LL2 or a researched entry does. */
export const ARMED_FORCES = new Set(['USAF', 'US Army', 'Italian Air Force']);

/** A source's agency label as a key in src/lib/agencies.ts, or undefined when it names none of them. */
export function agencyOf(label: string | null | undefined): string | undefined {
	if (!label) return undefined;
	for (const [re, key] of RULES) if (re.test(label)) return key;
	return undefined;
}

// ---------------------------------------------------------------- succession
interface Era {
	agency: string;
	/** First day it existed (ISO) — absent for the oldest. */
	from?: string;
	/** Day it gave way (ISO) — absent for the newest. */
	until?: string;
}
/** Each chain of agencies that replaced one another, oldest first. */
const SUCCESSION: Era[][] = [
	// The USSR dissolved on 26 Dec 1991; the Russian Space Agency (today's Roscosmos) was founded on 25 Feb 1992.
	[{ agency: 'CCCP', until: '1991-12-26' }, { agency: 'Roscosmos', from: '1992-02-25' }],
	// Canada's astronauts were the National Research Council's until the Canadian Space Agency took them on.
	[{ agency: 'NRC', until: '1989-03-01' }, { agency: 'CSA', from: '1989-03-01' }],
	// NASDA merged with ISAS and NAL into JAXA.
	[{ agency: 'NASDA', until: '2003-10-01' }, { agency: 'JAXA', from: '2003-10-01' }]
];
const chainOf = new Map(SUCCESSION.flatMap((chain) => chain.map((e) => [e.agency, chain] as const)));

const today = () => new Date().toISOString().slice(0, 10);
/** The agency, or whichever of its chain existed while the flight was up — both, for a flight aloft across
 *  the hand-over. One launched into a gap between the two (none has) would count for the older. */
function inEra(agency: string, f: Flight): string[] {
	const chain = chainOf.get(agency);
	if (!chain) return [agency];
	const end = f.ongoing ? today() : (f.landing ?? f.launch);
	const hit = chain.filter((e) => (!e.until || f.launch < e.until) && (!e.from || end >= e.from));
	return (hit.length ? hit : [chain.findLast((e) => !e.from || e.from <= f.launch) ?? chain[0]]).map((e) => e.agency);
}

// ---------------------------------------------------------------- commercial missions
// Missions a company ran, by mission label. Its own agency counts only on these — a Virgin Galactic pilot's
// earlier Shuttle flights are NASA's — and the agency that bought the seat counts beside it.
const PROVIDERS: [RegExp, string][] = [
	[/\bAx(?:iom)?\b.*\bMission\b|^Ax-\d/i, 'Axiom Space'],
	[/^Galactic \d|\bUnity\b|SpaceShipTwo/i, 'Virgin Galactic'],
	[/^NS-\d|New Shepard/i, 'Blue Origin'],
	[/SpaceShipOne/i, 'Scaled Composites'],
	[/Inspiration4|Polaris Dawn|Fram2/i, 'SpaceX']
];
const PROVIDER_AGENCIES = new Set(PROVIDERS.map(([, a]) => a));
const providerOf = (f: Flight) => PROVIDERS.find(([re]) => re.test(f.mission))?.[1];

/** Who a person flew for, flight by flight, given the agencies the sources name for them (in present-day
 *  or any era's terms) — oldest first. No researched list: see settleAgencies. */
export function attributeAgencies(agencies: string[], flights: Flight[]): string[] {
	const out: string[] = [];
	for (const f of [...flights].sort((a, b) => a.launch.localeCompare(b.launch))) {
		const provider = providerOf(f);
		for (const a of agencies) if (!PROVIDER_AGENCIES.has(a)) out.push(...inEra(a, f));
		if (provider) out.push(provider);
	}
	// A company named by the sources but matching none of the flights' labels is still their best answer.
	return [...new Set(out.length ? out : agencies)];
}

// ---------------------------------------------------------------- researched
// Keyed by the person's name in the dataset. Comments give the deciding fact; "Supercluster: …" notes
// where that source disagrees, so its cross-check (enrich-supercluster) stays quiet once reviewed.
const RESEARCHED: Record<string, string[]> = {
	// X-15 pilots who passed 50 miles as Air Force officers (NASA's own X-15 pilots — Walker, McKay,
	// Dana — stay NASA). Engle later flew the Shuttle as a NASA astronaut.
	'Robert M. White': ['USAF'],
	'Robert A. Rushworth': ['USAF'],
	'William J. Knight': ['USAF'],
	'Michael J. Adams': ['USAF'],
	'Joe Engle': ['USAF', 'NASA'],
	// Defense Department payload specialists: the Air Force's Manned Spaceflight Engineers, and the Army's
	// Terra Scout specialist.
	'Gary Payton': ['USAF'], // STS-51-C
	'William A. Pailes': ['USAF'], // STS-51-J
	'Thomas J. Hennen': ['US Army'], // STS-44
	// NASA astronauts who flew again for a company.
	'Frederick W. Sturckow': ['NASA', 'Virgin Galactic'], // Shuttle pilot, then SpaceShipTwo pilot
	'Peggy Whitson': ['NASA', 'Axiom Space'], // retired from NASA in 2018; Axiom's commander on Ax-2 and Ax-4
	'Michael López-Alegría': ['NASA', 'Axiom Space'], // commanded Ax-1 and Ax-3 as an Axiom employee
	// Commercial fliers a source ties to an agency they didn't fly for.
	'Anna Menon': ['SpaceX'], // a SpaceX engineer on Polaris Dawn; LL2: NASA, whose 2025 astronaut class she joined after
	'Sol Alan Stern': ['Virgin Galactic'], // on a seat his institute (SwRI) bought; NASA funded only his experiments; LL2: NASA
	'Michaela Benthaus': ['Blue Origin'], // an ESA graduate trainee, but flew NS-37 as a civilian; Supercluster adds ESA
	// Interkosmos guests: the Soviet bloc's (1978–81), then India's, Syria's, Bulgaria's second and
	// Afghanistan's — Supercluster files them under CCCP, LL2 under Roscosmos.
	'Vladimír Remek': ['Interkosmos'],
	'Mirosław Hermaszewski': ['Interkosmos'],
	'Sigmund Jähn': ['Interkosmos'],
	'Georgi Ivanov': ['Interkosmos'],
	'Bertalan Farkas': ['Interkosmos'],
	'Pham Tuan': ['Interkosmos'],
	'Arnaldo Tamayo Méndez': ['Interkosmos'],
	'Jügderdemidiin Gürragchaa': ['Interkosmos'],
	'Dumitru Prunariu': ['Interkosmos'],
	'Rakesh Sharma': ['Interkosmos'], // an Indian Air Force pilot, selected through Interkosmos
	'Muhammed Faris Al-Aqidi': ['Interkosmos'],
	'Aleksandr Panayotov Aleksandrov': ['Interkosmos'],
	'Abdul Ahad Mohmand': ['Interkosmos'],
	// Other guests on Soviet and Russian missions fly for their own agency or programme.
	'Jean-Loup Chrétien': ['CNES'], // all three flights (1982, 1988, 1997) as a CNES spationaut
	'Toyohiro Akiyama': ['CCCP'], // a TBS journalist on a seat TBS bought from the Soviet programme
	'Helen Sharman': ['Project Juno'],
	'Franz Viehböck': ['ASA'], // Austromir '91; Supercluster: Roscosmos
	'Marina Vasilevskaya': ['BSA'], // selected by Belarus; LL2: Roscosmos
	// France and Germany merged their astronaut corps into ESA's from 1998 (complete by 2002), so who
	// someone flew for depends on the date. ESA's history of its corps has the transfers.
	'Michel Tognini': ['CNES'], // STS-93 in July 1999; joined ESA that November
	'Jean-Pierre Haigneré': ['CNES', 'ESA'], // Altaïr (1993) for CNES; joined ESA in 1998, flew Perseus (1999) for it
	'Claudie Haigneré': ['CNES', 'ESA'], // Cassiopée (1996) for CNES; joined ESA in 1999, flew Andromède (2001)
	'Léopold Eyharts': ['CNES', 'ESA'], // Pégase (Jan 1998) for CNES; joined ESA in 1998, flew STS-122 (2008)
	'Philippe Perrin': ['CNES'], // STS-111 in June 2002; joined ESA that December; Supercluster adds ESA
	'Jean-François Clervoy': ['ESA'], // CNES-selected, joined ESA in 1992, before all his flights; Supercluster: CNES
	'Thomas Pesquet': ['ESA'], // never a CNES astronaut; Supercluster: CNES
	'Hans Schlegel': ['DLR', 'ESA'], // D-2 (1993) for DLR; joined ESA in 1998, flew STS-122 (2008)
	'Reinhold Ewald': ['DLR'], // Mir '97 for DLR; joined ESA in 1999
	'Gerhard Thiele': ['ESA'], // DLR-selected, joined ESA in August 1998, flew STS-99 (2000); Supercluster: DLR
	// Italy: ESA's astronauts fly for ESA even on a seat Italy's agency arranged; Supercluster adds ASI.
	'Umberto Guidoni': ['ASI', 'ESA'], // STS-75 (1996) as ASI's payload specialist; joined ESA in August 1998
	'Maurizio Cheli': ['ESA'], // selected by ESA in 1992
	'Roberto Vittori': ['ESA'], // selected by ESA in 1998
	'Luca Parmitano': ['ESA'],
	'Samantha Cristoforetti': ['ESA'],
	'Pantaleone Carlucci': ['CNR', 'Virgin Galactic'], // CNR researcher on the Air Force's Galactic 01; LL2: "National Research Council"
	// The agency that sent them, where the sources name another.
	'Sultan bin Salman Al Saud': ['ARABSAT'], // flew to deploy ARABSAT's satellite; LL2: a Saudi research institute
	'Alper Gezeravcı': ['TUA', 'Axiom Space'], // Türkiye's first astronaut, selected by TUA; LL2: Turkish Air Force
	'Marcos Pontes': ['AEB'], // Brazil's Centenary Mission; Supercluster: NASA, which trained him
	'Ilan Ramon': ['ISA'], // Supercluster: NASA
	'Chris Hadfield': ['CSA'] // Supercluster adds NASA
};

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const researched = new Map(Object.entries(RESEARCHED).map(([name, agencies]) => [normName(name), agencies]));

/** True when a researched entry decides this person's agencies (no source can change them). */
export const isResearched = (name: string) => researched.has(normName(name));

/** A person's settled agencies: a researched entry if there is one, else the sources' agencies attributed
 *  flight by flight (succession by date, commercial missions). */
export function settleAgencies(p: Pick<Person, 'name' | 'agencies' | 'flights'>): string[] {
	return [...(researched.get(normName(p.name)) ?? attributeAgencies(p.agencies, p.flights))];
}

/** RESEARCHED names that match nobody — renamed upstream, so the entry needs updating. */
export function unmatchedResearched(people: Pick<Person, 'name'>[]): string[] {
	const names = new Set(people.map((p) => normName(p.name)));
	return Object.keys(RESEARCHED).filter((name) => !names.has(normName(name)));
}

/** Keys used in this file that src/lib/agencies.ts doesn't define — a typo, or an entry to add there. */
export const undefinedKeys = () =>
	[
		...new Set([
			...RULES.map(([, k]) => k),
			...SUCCESSION.flat().map((e) => e.agency),
			...PROVIDER_AGENCIES,
			...Object.values(RESEARCHED).flat()
		])
	].filter((k) => !AGENCIES[k]);
