import type { Person } from './types';

export type ColorBy = 'nationality' | 'agency' | 'gender' | 'status';

export const COLOR_BY_OPTIONS: { id: ColorBy; label: string }[] = [
	{ id: 'nationality', label: 'Nationality' },
	{ id: 'agency', label: 'Agency' },
	{ id: 'gender', label: 'Gender' },
	{ id: 'status', label: 'Status' }
];

const PALETTE = [
	'#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#22d3ee', '#fb923c',
	'#818cf8', '#a3e635', '#2dd4bf', '#fb7185', '#c084fc', '#4ade80', '#facc15', '#38bdf8'
];

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
const hashColor = (s: string) => PALETTE[hash(s) % PALETTE.length];

const NATIONALITY: Record<string, string> = {
	'United States': '#3b82f6',
	Russia: '#ef4444',
	'Soviet Union': '#b91c1c',
	China: '#f59e0b',
	Japan: '#ec4899',
	Germany: '#9ca3af',
	France: '#6366f1',
	Canada: '#f43f5e',
	Italy: '#22c55e',
	'United Kingdom': '#8b5cf6',
	Unknown: '#71717a'
};
const AGENCY: Record<string, string> = {
	NASA: '#3b82f6',
	Roscosmos: '#ef4444',
	ESA: '#f59e0b',
	CNSA: '#eab308',
	JAXA: '#ec4899',
	CSA: '#f43f5e',
	ISRO: '#22c55e',
	SpaceX: '#9ca3af',
	'Blue Origin': '#38bdf8',
	'Virgin Galactic': '#a78bfa',
	'Axiom Space': '#2dd4bf',
	'Space Adventures': '#fb923c',
	'Scaled Composites': '#818cf8',
	Unknown: '#71717a'
};
const GENDER: Record<string, string> = {
	male: '#3b82f6',
	female: '#ec4899',
	other: '#a855f7',
	unknown: '#9ca3af'
};
const STATUS: Record<string, string> = {
	'in-space': '#22c55e',
	living: '#3b82f6',
	deceased: '#94a3b8'
};

export function valueOf(p: Person, by: ColorBy): string {
	return by === 'nationality' ? p.nationality : by === 'agency' ? p.agency : by === 'gender' ? p.gender : p.status;
}

export function colorFor(by: ColorBy, value: string): string {
	const map = by === 'nationality' ? NATIONALITY : by === 'agency' ? AGENCY : by === 'gender' ? GENDER : STATUS;
	return map[value] ?? hashColor(value);
}

export const STATUS_LABEL: Record<string, string> = {
	'in-space': 'In space now',
	living: 'Living',
	deceased: 'Deceased'
};
export const GENDER_LABEL: Record<string, string> = {
	male: 'Male',
	female: 'Female',
	other: 'Other',
	unknown: 'Unknown'
};

/** Display label for a raw category value under the active dimension. */
export function labelFor(by: ColorBy, value: string): string {
	if (by === 'status') return STATUS_LABEL[value] ?? value;
	if (by === 'gender') return GENDER_LABEL[value] ?? value;
	return value;
}

/** Flag emoji from an ISO 3166-1 alpha-2 code (lowercase), or '' if not derivable. */
export function flagEmoji(cc: string | null): string {
	if (!cc || cc.length !== 2) return '';
	const A = 0x1f1e6;
	return String.fromCodePoint(A + (cc.charCodeAt(0) - 97), A + (cc.charCodeAt(1) - 97));
}
