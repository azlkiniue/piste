import { browser } from '$app/environment';
import type { ColorBy } from './colors';

/** The Colour choice: a person dimension, or the station overview's neutral "expedition" option. */
export type ColourChoice = ColorBy | 'expedition';
const KEY = 'piste-colour';
const CHOICES: ColourChoice[] = ['expedition', 'nationality', 'agency', 'gender', 'status'];

/** Shared by every page and remembered across visits, like the theme — filters, by contrast, stay per page. */
export const colour = $state<{ by: ColourChoice }>({ by: 'nationality' });

/** The choice as a person dimension: the overview's neutral option shows as nationality everywhere else. */
export const personColour = (by: ColourChoice): ColorBy => (by === 'expedition' ? 'nationality' : by);

/** Call once on mount. Storage can be unavailable (a private window, blocked site data): the default stands. */
export function initColour() {
	if (!browser) return;
	try {
		const stored = localStorage.getItem(KEY) as ColourChoice | null;
		if (stored && CHOICES.includes(stored)) colour.by = stored;
	} catch {
		// keep the default
	}
}

export function setColour(by: ColourChoice) {
	colour.by = by;
	if (!browser) return;
	try {
		localStorage.setItem(KEY, by);
	} catch {
		// not remembered, but still applied
	}
}
