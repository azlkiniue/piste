<script lang="ts">
	import type { Person, Flight } from '$lib/types';
	import { makeScale, timeTicks, formatDate, formatDuration, DAY, YEAR } from '$lib/time-scale';
	import { colorFor, valueOf, type ColorBy } from '$lib/colors';
	import { flagEmoji } from '$lib/colors';

	interface Props {
		people: Person[];
		colorBy?: ColorBy;
		selectedSlug?: string | null;
		onselect?: (p: Person) => void;
	}
	let { people, colorBy = 'nationality', selectedSlug = null, onselect }: Props = $props();

	const LABEL_W = 188;
	const ROW_H = 26;
	const HEADER_H = 30;
	const MIN_BAR = 4;

	let viewportW = $state(1000);
	let zoom = $state(0); // px-per-year; 0 means "fit"

	const minMs = Date.UTC(1961, 0, 1);
	const maxMs = Date.now() + 150 * DAY;
	const totalYears = (maxMs - minMs) / YEAR;

	const fitPxPerYear = $derived(Math.max(3, (viewportW - LABEL_W - 14) / totalYears));
	const pxPerYear = $derived(zoom || fitPxPerYear);
	const plotW = $derived(Math.max(240, totalYears * pxPerYear));
	const scale = $derived(makeScale(minMs, maxMs, plotW));
	const ticks = $derived(timeTicks(minMs, maxMs, pxPerYear));
	const nowX = $derived(scale.x(Date.now()));
	const bodyH = $derived(people.length * ROW_H);

	function geom(f: Flight) {
		const s = Date.parse(f.launch);
		const e = f.ongoing ? Date.now() : Date.parse(f.landing ?? f.launch);
		const x = scale.x(s);
		return { x, w: Math.max(MIN_BAR, scale.x(e) - x) };
	}

	// zoom around the horizontal centre of the viewport
	let scrollEl = $state<HTMLDivElement>();
	function setZoom(next: number) {
		const el = scrollEl;
		const centerMs = el ? scale.invertX(el.scrollLeft + (el.clientWidth - LABEL_W) / 2) : minMs;
		zoom = Math.min(260, Math.max(fitPxPerYear, next));
		requestAnimationFrame(() => {
			if (!el) return;
			const ns = makeScale(minMs, maxMs, Math.max(240, totalYears * (zoom || fitPxPerYear)));
			el.scrollLeft = ns.x(centerMs) - (el.clientWidth - LABEL_W) / 2;
		});
	}

	// tooltip
	let hover = $state<{ p: Person; f: Flight; x: number; y: number } | null>(null);
	function showTip(e: MouseEvent, p: Person, f: Flight) {
		hover = { p, f, x: e.clientX, y: e.clientY };
	}
</script>

<div class="flex h-full flex-col">
	<!-- toolbar -->
	<div
		class="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
	>
		<span>{people.length.toLocaleString()} {people.length === 1 ? 'person' : 'people'}</span>
		<div class="flex items-center gap-1">
			<button
				class="grid h-6 w-6 place-items-center rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
				onclick={() => setZoom((zoom || fitPxPerYear) / 1.6)}
				disabled={pxPerYear <= fitPxPerYear + 0.01}
				aria-label="Zoom out">−</button
			>
			<button
				class="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
				onclick={() => (zoom = 0)}>Fit</button
			>
			<button
				class="grid h-6 w-6 place-items-center rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
				onclick={() => setZoom((zoom || fitPxPerYear) * 1.6)}
				disabled={pxPerYear >= 260}
				aria-label="Zoom in">+</button
			>
		</div>
	</div>

	<!-- scroll area -->
	<div bind:this={scrollEl} bind:clientWidth={viewportW} class="scrollbar-thin relative flex-1 overflow-auto">
		{#if people.length === 0}
			<div class="grid h-full place-items-center p-8 text-center text-sm text-zinc-500">
				No one matches these filters.
			</div>
		{:else}
			<div class="relative" style="width:{LABEL_W + plotW}px; height:{HEADER_H + bodyH}px">
				<!-- gridlines + now line -->
				<div class="pointer-events-none absolute top-0" style="left:{LABEL_W}px; width:{plotW}px; height:100%">
					{#each ticks as t (t.ms)}
						<div
							class="absolute top-0 h-full border-l {t.major
								? 'border-zinc-300/70 dark:border-zinc-700/70'
								: 'border-zinc-200/60 dark:border-zinc-800/50'}"
							style="left:{scale.x(t.ms)}px"
						></div>
					{/each}
					<div class="absolute top-0 h-full border-l-2 border-emerald-500/70" style="left:{nowX}px"></div>
				</div>

				<!-- axis -->
				<div class="sticky top-0 z-30 flex" style="height:{HEADER_H}px">
					<div
						class="sticky left-0 z-10 flex items-center bg-zinc-50 px-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:bg-zinc-950"
						style="width:{LABEL_W}px"
					>
						Astronaut
					</div>
					<div class="relative flex-1 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
						{#each ticks as t (t.ms)}
							<div
								class="absolute top-1.5 -translate-x-1/2 text-[11px] tabular-nums {t.major
									? 'font-semibold text-zinc-600 dark:text-zinc-300'
									: 'text-zinc-400'}"
								style="left:{scale.x(t.ms)}px"
							>
								{t.label}
							</div>
						{/each}
						<div
							class="absolute top-1.5 -translate-x-1/2 rounded bg-emerald-500/15 px-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
							style="left:{nowX}px"
						>
							now
						</div>
					</div>
				</div>

				<!-- rows -->
				{#each people as p (p.slug)}
					{@const color = colorFor(colorBy, valueOf(p, colorBy))}
					{@const selected = p.slug === selectedSlug}
					<div
						class="group flex cursor-pointer {selected
							? 'bg-zinc-200/70 dark:bg-zinc-800/70'
							: 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}"
						style="height:{ROW_H}px"
						onclick={() => onselect?.(p)}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onselect?.(p)}
						role="button"
						tabindex="-1"
					>
						<div
							class="sticky left-0 z-20 flex items-center gap-1.5 overflow-hidden border-b border-zinc-100 px-3 dark:border-zinc-900 {selected
								? 'bg-zinc-200/95 dark:bg-zinc-800/95'
								: 'bg-zinc-50 group-hover:bg-zinc-100 dark:bg-zinc-950 dark:group-hover:bg-zinc-900'}"
							style="width:{LABEL_W}px"
						>
							<span class="text-xs leading-none">{flagEmoji(p.countryCode) || '·'}</span>
							<span class="truncate text-[13px] text-zinc-700 dark:text-zinc-200">{p.name}</span>
							{#if p.status === 'in-space'}
								<span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="In space now"></span>
							{/if}
						</div>
						<div class="relative flex-1 border-b border-zinc-100/70 dark:border-zinc-900/70">
							{#each p.flights as f, i (i)}
								{@const g = geom(f)}
								<div
									class="absolute top-1/2 -translate-y-1/2 rounded-[2px] {f.ongoing ? 'piste-ongoing' : ''}"
									class:opacity-80={!f.orbital}
									style="left:{g.x}px; width:{g.w}px; height:{f.orbital ? 13 : 9}px; background:{color}; {f.orbital
										? ''
										: `outline:1px solid ${color}; background:transparent;`}"
									onmouseenter={(e) => showTip(e, p, f)}
									onmousemove={(e) => showTip(e, p, f)}
									onmouseleave={() => (hover = null)}
									role="presentation"
								></div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if hover}
	<div
		class="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
		style="left:{Math.min(hover.x + 14, viewportW - 240)}px; top:{hover.y + 14}px"
	>
		<div class="font-semibold text-zinc-800 dark:text-zinc-100">{hover.p.name}</div>
		<div class="mt-0.5 text-zinc-600 dark:text-zinc-300">{hover.f.mission}</div>
		<div class="mt-1 flex items-center gap-1.5 text-zinc-500">
			<span>{formatDate(hover.f.launch)}</span>
			<span>→</span>
			<span>{hover.f.ongoing ? 'now' : formatDate(hover.f.landing)}</span>
		</div>
		<div class="mt-0.5 flex items-center gap-2 text-zinc-400">
			<span>{formatDuration(hover.f.launch, hover.f.ongoing ? null : hover.f.landing)}</span>
			<span>·</span>
			<span>{hover.f.orbital ? 'orbital' : 'suborbital'}</span>
			{#if hover.f.approx}<span>· approx.</span>{/if}
		</div>
	</div>
{/if}

<style>
	.piste-ongoing {
		background-image: linear-gradient(90deg, currentColor 0%, transparent 100%);
		animation: piste-pulse 2s ease-in-out infinite;
	}
	@keyframes piste-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
</style>
