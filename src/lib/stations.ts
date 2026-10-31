/**
 * Every Station a Stay or Expedition may name, keyed by slug, in launch order. Shared by the app (labels,
 * the station pages) and the data pipeline (which maps LL2's station names onto these keys, see
 * scripts/stations.ts, and warns about any crewed one it can't place). Only Stations that have had a crew:
 * Salyut 2, Kosmos-557 and Genesis I/II never did.
 */
export interface Station {
	/** The name the app shows. The current Chinese station is plain "Tiangong". */
	short: string;
	/** Full name, when it differs from the short one. */
	name?: string;
	/** A line of history for the station pages. */
	note?: string;
}

export const STATIONS: Record<string, Station> = {
	'salyut-1': { short: 'Salyut 1', note: 'The first space station. Its only crew, Soyuz 11, died on the way home' },
	skylab: { short: 'Skylab', note: "NASA's first space station, built from a Saturn V third stage" },
	'salyut-3': { short: 'Salyut 3', note: 'A military Almaz station flown under the Salyut name' },
	'salyut-4': { short: 'Salyut 4', note: 'A civilian station, crewed twice in 1975' },
	'salyut-5': { short: 'Salyut 5', note: 'The last military Almaz station' },
	'salyut-6': { short: 'Salyut 6', note: 'The first with two docking ports, so it could be resupplied and host visiting crews' },
	'salyut-7': { short: 'Salyut 7', note: 'Revived by Dzhanibekov and Savinykh after it lost power in 1985' },
	mir: { short: 'Mir', note: 'The first modular station, assembled from 1986 to 1996' },
	iss: {
		short: 'ISS',
		name: 'International Space Station',
		note: 'Built by the US, Russia, Europe, Japan and Canada; crewed continuously since November 2000'
	},
	'tiangong-1': { short: 'Tiangong-1', note: "China's first space laboratory" },
	'tiangong-2': { short: 'Tiangong-2', note: "China's second space laboratory" },
	tiangong: { short: 'Tiangong', note: "China's modular space station, crewed continuously since 2022" }
};
