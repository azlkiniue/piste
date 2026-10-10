import { COUNTRY_CODE } from './countries';

// Round flag icons, one SVG per code in assets/flags — copies of just the flags the data uses, which
// the data pipeline keeps in sync from the circle-flags devDependency (see scripts/flags.ts). SVGs
// render the same on every platform — flag emoji don't (Windows shows letters) and have no glyph at
// all for defunct states like the Soviet Union.
const FLAGS = import.meta.glob<string>('./assets/flags/*.svg', { eager: true, query: '?url', import: 'default' });

/** Flag image URL for a nationality (country name), or undefined when there's no flag for it. */
export function flagUrl(country: string): string | undefined {
	const code = COUNTRY_CODE[country];
	return code ? FLAGS[`./assets/flags/${code}.svg`] : undefined;
}
