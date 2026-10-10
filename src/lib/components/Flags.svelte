<script lang="ts">
	import { flagUrl } from '$lib/flags';

	interface Props {
		/** Country names, primary first — the primary is drawn in front. */
		countries: string[];
		/** Flag diameter, px. */
		size?: number;
		/** How many flags' width to occupy (default: as many as there are). Give every row the same value
		 *  and whatever follows lines up; extra flags fan out tighter to fit. */
		reserve?: number;
	}
	let { countries, size = 14, reserve }: Props = $props();

	// A flag behind another peeks out by STEP of its diameter, with a GAP-px sliver cut away where the one
	// in front overlaps it — a mask rather than a background-coloured ring, so it suits any row background.
	const STEP = 0.65;
	const GAP = 1.5;

	const named = $derived(countries.length ? countries : ['Unknown']);
	// A flag shared by two of them (West Germany, then Germany) is drawn once; the label names both.
	const shown = $derived.by(() => {
		const seen = new Set<string | undefined>();
		const out: { country: string; url?: string }[] = [];
		for (const country of named) {
			const url = flagUrl(country);
			if (url && seen.has(url)) continue;
			seen.add(url);
			out.push({ country, url });
		}
		return out;
	});
	const width = $derived(size * (1 + STEP * (Math.max(1, reserve ?? shown.length) - 1)));
	const step = $derived(shown.length > 1 ? Math.min(size * STEP, (width - size) / (shown.length - 1)) : 0);
	// Centred on the flag in front, in this flag's own coordinates.
	const mask = $derived(
		`radial-gradient(circle at ${size / 2 - step}px 50%, transparent ${size / 2 + GAP}px, #000 ${size / 2 + GAP + 0.5}px)`
	);
</script>

<span
	class="relative inline-block shrink-0"
	style="width:{width}px; height:{size}px"
	role="img"
	aria-label={named.join(', ')}
	title={named.join(' · ')}
>
	{#each shown as { country, url }, i (country)}
		{@const style = `left:${i * step}px; width:${size}px; height:${size}px; z-index:${shown.length - i};${i ? ` -webkit-mask-image:${mask}; mask-image:${mask};` : ''}`}
		{#if url}
			<img src={url} alt="" draggable="false" class="absolute top-0 rounded-full outline-1 -outline-offset-1 outline-black/10 dark:outline-white/15" {style} />
		{:else}
			<span class="absolute top-0 rounded-full bg-zinc-300 dark:bg-zinc-600" {style}></span>
		{/if}
	{/each}
</span>
