// Minimal linear time scale + tick generator for the timeline (no D3 dependency).

export const DAY = 86_400_000;
export const YEAR = 365.25 * DAY;

export interface Scale {
	minMs: number;
	maxMs: number;
	width: number;
	x(ms: number): number;
	invertX(px: number): number;
}

export function makeScale(minMs: number, maxMs: number, width: number): Scale {
	const span = Math.max(1, maxMs - minMs);
	return {
		minMs,
		maxMs,
		width,
		x: (ms) => ((ms - minMs) / span) * width,
		invertX: (px) => minMs + (px / width) * span
	};
}

export interface Tick {
	ms: number;
	label: string;
	major: boolean; // decade boundary
}

/** Year ticks whose density adapts to the zoom level. */
export function timeTicks(minMs: number, maxMs: number, pxPerYear: number): Tick[] {
	const start = new Date(minMs).getUTCFullYear();
	const end = new Date(maxMs).getUTCFullYear();
	const step = pxPerYear >= 55 ? 1 : pxPerYear >= 26 ? 5 : 10;
	const ticks: Tick[] = [];
	for (let y = Math.ceil(start / step) * step; y <= end; y += step) {
		ticks.push({ ms: Date.UTC(y, 0, 1), label: `'${String(y).slice(2)}`, major: y % 10 === 0 });
	}
	// Always label decades with the full year when the step hides them.
	return ticks.map((t) => (t.major ? { ...t, label: String(new Date(t.ms).getUTCFullYear()) } : t));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ticks for zooms closer than timeTicks goes — the station view reaches Salyut 1's 23 days of crew. Years as
 *  timeTicks gives them, then months (a year's January labelled with the year), then days (a month's 1st
 *  labelled with the month). Only the span [minMs, maxMs] is ticked, so a caller can pass just what's in view. */
export function fineTicks(minMs: number, maxMs: number, pxPerYear: number): Tick[] {
	if (pxPerYear < 400) return timeTicks(minMs, maxMs, pxPerYear);
	const ticks: Tick[] = [];
	const pxPerDay = pxPerYear / 365.25;
	const from = new Date(minMs);
	if (pxPerDay < 4) {
		const step = pxPerYear / 12 >= 36 ? 1 : 3;
		for (let y = from.getUTCFullYear(), m = from.getUTCMonth(); Date.UTC(y, m, 1) <= maxMs; m === 11 ? (y++, (m = 0)) : m++) {
			const ms = Date.UTC(y, m, 1);
			if (ms >= minMs && m % step === 0) ticks.push({ ms, label: m === 0 ? String(y) : MONTHS[m], major: m === 0 });
		}
		return ticks;
	}
	const shown = (d: number) => (pxPerDay >= 22 ? true : pxPerDay >= 8 ? d === 1 || d % 5 === 0 : d === 1 || d === 10 || d === 20);
	for (let ms = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); ms <= maxMs; ms += DAY) {
		const d = new Date(ms);
		const day = d.getUTCDate();
		if (ms < minMs || !shown(day) || (day === 30 && pxPerDay < 22)) continue;
		ticks.push({ ms, label: day === 1 ? `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` : String(day), major: day === 1 });
	}
	return ticks;
}

/** "12 Apr 1961" — or "Oct 1975" / "1988" for a date known only to the month or year ("1975-10", "1988"). */
export function formatDate(iso: string | null): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (iso.length === 4) return `${d.getUTCFullYear()}`;
	if (iso.length === 7) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Human duration between two ISO dates (or to now if landing is null). */
export function formatDuration(launch: string, landing: string | null): string {
	const end = landing ? Date.parse(landing) : Date.now();
	const days = Math.max(0, Math.round((end - Date.parse(launch)) / DAY));
	if (days === 0) return '<1 day';
	if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
	const months = Math.floor(days / 30.44);
	if (days < 365) return `${months} months`;
	const years = Math.floor(days / 365.25);
	const remMonths = Math.round((days - years * 365.25) / 30.44);
	return remMonths ? `${years}y ${remMonths}m` : `${years} year${years === 1 ? '' : 's'}`;
}
