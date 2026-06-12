import { browser } from '$app/environment';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'piste-theme';

export const theme = $state<{ value: Theme }>({ value: 'system' });

function apply() {
	if (!browser) return;
	const dark = theme.value === 'dark' || (theme.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.classList.toggle('dark', dark);
}

/** Call once on mount: sync the store with persisted choice and react to OS theme changes. */
export function initTheme() {
	if (!browser) return;
	const stored = localStorage.getItem(KEY) as Theme | null;
	theme.value = stored ?? 'system';
	apply();
	matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (theme.value === 'system') apply();
	});
}

export function setTheme(t: Theme) {
	theme.value = t;
	if (!browser) return;
	if (t === 'system') localStorage.removeItem(KEY);
	else localStorage.setItem(KEY, t);
	apply();
}

export function cycleTheme() {
	const order: Theme[] = ['system', 'light', 'dark'];
	setTheme(order[(order.indexOf(theme.value) + 1) % order.length]);
}
