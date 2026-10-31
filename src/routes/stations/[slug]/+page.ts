import { error } from '@sveltejs/kit';
import { STATIONS } from '$lib/stations';
import type { EntryGenerator, PageLoad } from './$types';

// One prerendered page per Station in the registry.
export const entries: EntryGenerator = () => Object.keys(STATIONS).map((slug) => ({ slug }));

export const load: PageLoad = ({ params }) => {
	if (!STATIONS[params.slug]) error(404, 'No such station');
	return { slug: params.slug };
};
