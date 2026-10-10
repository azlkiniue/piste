/**
 * Every agency a person's `agencies` may name, keyed by the short name the app shows first — usually its
 * abbreviation (NASDA, KazCosmos). Shared by the app (labels, full names) and the data pipeline (which maps
 * each source's vocabulary onto these keys, see scripts/agency.ts, and warns about any key missing here).
 *
 * An entry is one organization. One that merged into or was replaced by another is its own entry (NASDA
 * before JAXA, Canada's NRC before the CSA, the Soviet programme before Roscosmos), so a person lists each
 * one they flew for. A mere rename stays one entry under today's name, its earlier names in `note`
 * (Roscosmos was the Russian Space Agency in 1994).
 */
export interface Agency {
	/** Full name, when the key is an abbreviation (NASDA → National Space Development Agency of Japan). */
	name?: string;
	/** A line of history for the detail view: earlier names, or what became of it. */
	note?: string;
}

export const AGENCIES: Record<string, Agency> = {
	// ── government agencies and programmes
	AEB: { name: 'Brazilian Space Agency' },
	ANGKASA: { name: 'Malaysian National Space Agency', note: 'Merged into the Malaysian Space Agency (MYSA) in 2019' },
	ARABSAT: { name: 'Arab Satellite Communications Organization' },
	ASA: { name: 'Austrian Space Agency' },
	ASI: { name: 'Italian Space Agency' },
	BSA: { name: 'Belarus Space Agency', note: 'Part of the National Academy of Sciences of Belarus' },
	CCCP: { name: 'Soviet space programme', note: 'The USSR had no single space agency — Roscosmos followed in 1992' },
	CMSA: { name: 'China Manned Space Agency' },
	CNES: { name: 'National Centre for Space Studies' },
	CNR: { name: 'National Research Council of Italy' },
	CSA: { name: 'Canadian Space Agency' },
	DLR: {
		name: 'German Aerospace Center',
		note: 'DFVLR until 1989, then the German Research Institute for Aviation and Spaceflight until 1997'
	},
	ESA: { name: 'European Space Agency' },
	HUNOR: { name: 'Hungarian to Orbit programme', note: "Run by Hungary's Ministry of Foreign Affairs and Trade" },
	Interkosmos: {
		name: 'Interkosmos Council, USSR Academy of Sciences',
		note: 'The Soviet programme that flew cosmonauts from allied countries, 1978–88'
	},
	ISA: { name: 'Israel Space Agency' },
	ISRO: { name: 'Indian Space Research Organisation' },
	'Italian Air Force': { name: 'Aeronautica Militare' },
	JAXA: { name: 'Japan Aerospace Exploration Agency' },
	KAP: { name: 'Korean Astronaut Program', note: "Run by South Korea's Ministry of Science and Technology" },
	KazCosmos: { name: 'National Space Agency of the Republic of Kazakhstan' },
	MBRSC: { name: 'Mohammed bin Rashid Space Centre' },
	NASA: { name: 'National Aeronautics and Space Administration' },
	NASDA: { name: 'National Space Development Agency of Japan', note: 'Merged into JAXA in 2003' },
	NRC: { name: 'National Research Council Canada', note: "Ran Canada's astronaut programme until the CSA was founded in 1989" },
	'Project Juno': { note: 'A British private consortium; the Soviet side ended up paying for the flight' },
	Roscosmos: {
		name: 'Roscosmos State Corporation for Space Activities',
		note: 'Russian Space Agency (RKA) 1992–99, Russian Aviation and Space Agency 1999–2004, Federal Space Agency 2004–15'
	},
	SSA: { name: 'Saudi Space Agency', note: 'Saudi Space Commission (SSC) until June 2023' },
	SSAU: { name: 'State Space Agency of Ukraine', note: 'National Space Agency of Ukraine (NSAU) until 2010' },
	TUA: { name: 'Turkish Space Agency' },
	'US Army': { name: 'United States Army' },
	USAF: { name: 'United States Air Force' },

	// ── companies
	'Axiom Space': {},
	'Blue Origin': {},
	'Scaled Composites': {},
	'Space Adventures': {},
	SpaceX: { name: 'Space Exploration Technologies Corp.' },
	'Virgin Galactic': {}
};
