// Shared data model for Piste. Produced by scripts/build-data.ts, consumed by the app.

export type Gender = 'male' | 'female' | 'other' | 'unknown';
export type Status = 'in-space' | 'living' | 'deceased';

export interface Flight {
	/** Mission / spacecraft name, e.g. "Soyuz MS-23". */
	mission: string;
	/** Launch date, ISO YYYY-MM-DD. */
	launch: string;
	/** Landing date (ISO YYYY-MM-DD), or null when ongoing or unknown. */
	landing: string | null;
	/** Currently in space — the bar runs to "today". */
	ongoing: boolean;
	/** Orbital (true) vs suborbital (false). */
	orbital: boolean;
	/** Landing date was missing/estimated — render with caution. */
	approx: boolean;
	/** When a trip merges several missions (e.g. Soyuz up + seat-swap down), their names. */
	segments?: string[];
}

export interface Person {
	id: string;
	/** Wikidata QID, e.g. "Q1234". */
	qid: string | null;
	name: string;
	/** URL-safe unique id used for ?person= deep links. */
	slug: string;
	/** Country of citizenship (normalized), e.g. "United States". */
	nationality: string;
	/** ISO 3166-1 alpha-2 (lowercase) for flag rendering, or null. */
	countryCode: string | null;
	gender: Gender;
	/** Space agency / provider, e.g. "NASA". "Unknown" until LL2 enrichment fills gaps. */
	agency: string;
	status: Status;
	/** Date of birth / death, ISO YYYY-MM-DD or null. */
	dob: string | null;
	dod: string | null;
	/** English Wikipedia article URL, or null. */
	wiki: string | null;
	/** Remote Wikimedia photo URL (never bundled), or null. */
	image: string | null;
	/** Cumulative days in space across all flights (rounded). */
	totalDaysInSpace: number;
	/** Earliest launch (ISO) — primary sort key. */
	firstLaunch: string;
	/** Latest landing (ISO) or null if still in space. */
	lastLanding: string | null;
	flights: Flight[];
	/** LL2 enrichment (optional): total spacewalks. */
	spacewalks?: number;
	/** LL2 enrichment (optional): agency type, e.g. "Government" or "Private". */
	agencyType?: string;
}

export interface Meta {
	generatedAt: string;
	/** Snapshot date for "currently in space". */
	asOf: string;
	sources: { name: string; url: string; license: string }[];
	counts: {
		people: number;
		flights: number;
		inSpace: number;
		orbital: number;
		suborbital: number;
		countries: number;
		agencies: number;
	};
	coverage: {
		genderKnown: number;
		withImage: number;
		withAgency: number;
		realLandingFlights: number;
		approxFlights: number;
	};
	/** "In space now" names from open-notify that didn't match a person. */
	inSpaceUnmatched: string[];
}
