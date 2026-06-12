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

/** "12 Apr 1961" */
export function formatDate(iso: string | null): string {
	if (!iso) return '—';
	const d = new Date(iso);
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
