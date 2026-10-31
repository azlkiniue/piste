import { browser } from '$app/environment';
import type { ColorBy } from './colors';

/** The Colour choice: a person dimension, or the station overview's neutral "expedition" option. */
export type ColorChoice = ColorBy | 'expedition';
const KEY = 'piste-colour';
const CHOICES: ColorChoice[] = ['expedition', 'nationality', 'agency', 'gender', 'status'];

/** Shared by every page and remembered across visits, like the theme — filters, by contrast, stay per page.
 *  It starts neutral, so the overview opens in Expedition shades until someone picks a person dimension. */
export const colorChoice = $state<{ by: ColorChoice }>({ by: 'expedition' });

/** The choice as a person dimension: the overview's neutral option shows as nationality everywhere else. */
export const personColor = (by: ColorChoice): ColorBy => (by === 'expedition' ? 'nationality' : by);

/** Call once on mount. Storage can be unavailable (a private window, blocked site data): the default stands. */
export function initColorChoice() {
	if (!browser) return;
	try {
		const stored = localStorage.getItem(KEY) as ColorChoice | null;
		if (stored && CHOICES.includes(stored)) colorChoice.by = stored;
	} catch {
		// keep the default
	}
}

export function setColorChoice(by: ColorChoice) {
	colorChoice.by = by;
	if (!browser) return;
	try {
		localStorage.setItem(KEY, by);
	} catch {
		// not remembered, but still applied
	}
}
