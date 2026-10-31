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
	/** The Stays this flight made aboard Stations, in order — absent when it visited none. */
	stays?: Stay[];
}

export interface Stay {
	/** Station slug — a key of src/lib/stations.ts. */
	station: string;
	/** Docking of the craft they arrived in, ISO YYYY-MM-DD. */
	arrive: string;
	/** Undocking of the craft they left in (ISO YYYY-MM-DD), or null while still aboard. */
	depart: string | null;
	/** Still aboard — the bar runs to "today". */
	ongoing: boolean;
	/** Slugs of the Expeditions this Stay belongs to; empty for a Visitor. */
	expeditions: string[];
	/** No docking data for one end — that date is the flight's, so render with caution. */
	approx: boolean;
}

/** A Station's long-duration resident crew for one continuous stretch. Its crew are the Stays naming it. */
export interface Expedition {
	/** Unique within its Station, e.g. "expedition-50", "eo-27", "shenzhou-19". */
	slug: string;
	/** Station slug — a key of src/lib/stations.ts. */
	station: string;
	/** As the Station named it, e.g. "Expedition 50", "EO-27", "Skylab 2", "Shenzhou 19". */
	name: string;
	/** Start and end — crew handovers, not anyone's Stay. ISO YYYY-MM-DD; end is null while under way. */
	start: string;
	end: string | null;
	ongoing: boolean;
}

/** When a Station was in orbit. */
export interface StationLife {
	/** Station slug — a key of src/lib/stations.ts. */
	slug: string;
	/** Launch, ISO YYYY-MM-DD. */
	launched: string;
	/** Deorbit (ISO YYYY-MM-DD), or null while still in orbit. */
	deorbited: string | null;
}

/** The station dataset (src/lib/data/stations.min.json). Produced by scripts/stations.ts. */
export interface StationData {
	stations: StationLife[];
	expeditions: Expedition[];
}

export interface Person {
	id: string;
	/** Wikidata QID, e.g. "Q1234". */
	qid: string | null;
	name: string;
	/** URL-safe unique id used for ?person= deep links. */
	slug: string;
	/** Nationalities, primary first — names from src/lib/countries.ts. The state(s) the person flew for,
	 *  defunct ones included (the Soviet Union for flights before it dissolved), plus any other
	 *  citizenship they held at the time. e.g. ["Soviet Union", "Russia"], ["United States", "United Kingdom"]. */
	nationalities: string[];
	gender: Gender;
	/** Agencies the person flew for, oldest first — keys of src/lib/agencies.ts, each as it was when they
	 *  flew (NASDA before JAXA; the Soviet programme, CCCP, before Roscosmos), plus the company that ran a
	 *  commercial flight. e.g. ["NASDA", "JAXA"], ["ISRO", "Axiom Space"]. Empty when unknown. */
	agencies: string[];
	status: Status;
	/** Date of birth / death, ISO YYYY-MM-DD — or YYYY-MM / YYYY when the sources know only the month or
	 *  year — or null. */
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
	/** "In space now" names from the ISS APIs snapshot that didn't match a person. */
	inSpaceUnmatched: string[];
}
