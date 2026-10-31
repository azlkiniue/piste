<script lang="ts">
	import { tick } from 'svelte';
	import type { Expedition, Person, StationLife } from '$lib/types';
	import { makeScale, fineTicks, formatDate, formatDuration, DAY, YEAR } from '$lib/time-scale';
	import { colorFor, valueOf, type ColorBy } from '$lib/colors';
	import { STATIONS } from '$lib/stations';
	import { endMs, type StayRow } from '$lib/station-index';
	import Flags from './Flags.svelte';

	interface Props {
		life: StationLife;
		expeditions: Expedition[];
		/** One row per Person, with the Stays to draw. */
		rows: { person: Person; stays: StayRow[] }[];
		/** The Station's occupied period [first arrival, last departure] — what it opens fitted to, whatever is filtered. */
		occupied: [number, number];
		colorBy: ColorBy;
		/** An Expedition to zoom to and pick out. */
		focus?: string | null;
		selectedSlug?: string | null;
		onselect?: (p: Person) => void;
	}
	let { life, expeditions, rows, occupied, colorBy, focus = null, selectedSlug = null, onselect }: Props = $props();

	const LABEL_W = 196;
	const ROW_H = 26;
	const AXIS_H = 30;
	const BAND_H = 22;
	const HEADER_H = AXIS_H + BAND_H;
	const MAX_PX_PER_DAY = 40;

	let viewportW = $state(0); // until measured: nothing is placed before then
	let scrollLeft = $state(0);
	let zoom = $state(0); // px-per-year; 0 means "fit the occupied period"

	// The plot spans the Station's life; it opens on the occupied period, and zooms out as far as the life.
	const lifeMin = $derived(Date.parse(life.launched));
	const lifeMax = $derived(life.deorbited ? Date.parse(life.deorbited) : Date.now() + 60 * DAY);
	const lifeYears = $derived((lifeMax - lifeMin) / YEAR);
	const avail = $derived(Math.max(200, viewportW - LABEL_W - 14));
	const padOf = (a: number, b: number) => Math.max(2 * DAY, 0.04 * (b - a));
	const fitFor = (a: number, b: number) => avail / ((b - a + 2 * padOf(a, b)) / YEAR);
	const fitLife = $derived(avail / lifeYears);
	const fitOccupied = $derived(Math.max(fitLife, fitFor(occupied[0], occupied[1])));
	const maxZoom = $derived(Math.max(fitOccupied, MAX_PX_PER_DAY * 365.25));
	const pxPerYear = $derived(zoom || fitOccupied);
	const plotW = $derived(Math.max(avail, lifeYears * pxPerYear));
	const scale = $derived(makeScale(lifeMin, lifeMax, plotW));
	// Ticks only for what's in view (and a screen either side): zoomed in on the ISS, its whole life would be ten thousand days.
	const ticks = $derived(
		fineTicks(Math.max(lifeMin, scale.invertX(scrollLeft - avail)), Math.min(lifeMax, scale.invertX(scrollLeft + 2 * avail)), pxPerYear)
	);
	// A deorbited Station has no "now": its line would sit decades past the end of the plot.
	const nowX = $derived(life.deorbited ? null : scale.x(Date.now()));
	const bodyH = $derived(rows.length * ROW_H);

	let scrollEl = $state<HTMLDivElement>();
	/** Zoom to show [a, b] with a little room either side (zoom 0: the occupied fit, which follows the width). */
	async function show(a: number, b: number, pxYear = Math.min(maxZoom, Math.max(fitLife, fitFor(a, b)))) {
		zoom = pxYear;
		await tick(); // the plot at its new width, then scroll
		if (scrollEl) scrollEl.scrollLeft = scale.x(a - padOf(a, b));
	}
	// zoom around the horizontal centre of the viewport
	async function setZoom(next: number) {
		const centerMs = scrollEl ? scale.invertX(scrollEl.scrollLeft + avail / 2) : lifeMin;
		zoom = Math.min(maxZoom, Math.max(fitLife, next));
		await tick();
		if (scrollEl) scrollEl.scrollLeft = scale.x(centerMs) - avail / 2;
	}

	// Open on the focused Expedition, or the occupied period; refocus when the focus changes.
	const focused = $derived(focus ? expeditions.find((x) => x.slug === focus) ?? null : null);
	let placedFor: string | undefined;
	$effect(() => {
		if (!scrollEl || viewportW <= 0) return;
		const key = focused?.slug ?? '';
		if (placedFor === key) return;
		placedFor = key;
		if (focused) {
			// …and down to its crew. Rows go by first arrival, so veterans' rows sit far above (Whitson's, from
			// 2002, for Expedition 50) while its newcomers cluster by date: anchor on the newest, low in the view.
			const last = rows.findLastIndex((row) => row.stays.some((r) => r.stay.expeditions.includes(focused.slug)));
			show(Date.parse(focused.start), endMs(focused.end)).then(() => {
				if (scrollEl && last >= 0) scrollEl.scrollTop = Math.max(0, HEADER_H + last * ROW_H - scrollEl.clientHeight * 0.7);
			});
		} else show(occupied[0], occupied[1], 0);
	});

	const span = (a: number, b: number, min: number) => {
		const x = scale.x(a);
		return { x, w: Math.max(min, scale.x(b) - x) };
	};

	let hover = $state<{ r: StayRow; cx: number; cy: number } | null>(null);
	const names = $derived(new Map(expeditions.map((x) => [x.slug, x.name])));
</script>

<div class="flex h-full flex-col">
	<!-- toolbar -->
	<div
		class="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
	>
		<span class="flex items-center gap-3">
			<span>{rows.length.toLocaleString()} {rows.length === 1 ? 'person' : 'people'}</span>
			<span class="hidden items-center gap-1.5 sm:flex"><span class="h-[11px] w-4 rounded-[2px] bg-zinc-400"></span>Expedition crew</span>
			<span class="hidden items-center gap-1.5 sm:flex"><span class="h-[5px] w-4 rounded-[2px] bg-zinc-400"></span>Visitor</span>
		</span>
		<div class="flex items-center gap-1">
			<button
				class="grid h-6 w-6 place-items-center rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
				onclick={() => setZoom(pxPerYear / 1.6)}
				disabled={pxPerYear <= fitLife + 0.01}
				aria-label="Zoom out">−</button
			>
			<button
				class="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
				onclick={() => show(occupied[0], occupied[1], 0)}>Fit</button
			>
			<button
				class="grid h-6 w-6 place-items-center rounded border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
				onclick={() => setZoom(pxPerYear * 1.6)}
				disabled={pxPerYear >= maxZoom}
				aria-label="Zoom in">+</button
			>
		</div>
	</div>

	<div
		bind:this={scrollEl}
		bind:clientWidth={viewportW}
		onscroll={(e) => (scrollLeft = e.currentTarget.scrollLeft)}
		class="scrollbar-thin relative flex-1 overflow-auto"
	>
		{#if rows.length === 0}
			<div class="grid h-full place-items-center p-8 text-center text-sm text-zinc-500">No one matches these filters.</div>
		{:else}
			<div class="relative" style="width:{LABEL_W + plotW}px; height:{HEADER_H + bodyH}px">
				<!-- Expedition stripes, gridlines, now line -->
				<div class="pointer-events-none absolute top-0" style="left:{LABEL_W}px; width:{plotW}px; height:100%">
					{#each expeditions as x, i (x.slug)}
						{@const g = span(Date.parse(x.start), endMs(x.end), 1)}
						<div
							class="absolute top-0 h-full {x.slug === focus
								? 'bg-sky-500/10'
								: i % 2
									? 'bg-zinc-200/40 dark:bg-zinc-800/30'
									: ''}"
							style="left:{g.x}px; width:{g.w}px"
						></div>
					{/each}
					{#each ticks as t (t.ms)}
						<div
							class="absolute top-0 h-full border-l {t.major
								? 'border-zinc-300/70 dark:border-zinc-700/70'
								: 'border-zinc-200/60 dark:border-zinc-800/50'}"
							style="left:{scale.x(t.ms)}px"
						></div>
					{/each}
					{#if nowX !== null}<div class="absolute top-0 h-full border-l-2 border-emerald-500/70" style="left:{nowX}px"></div>{/if}
				</div>

				<!-- axis + Expedition bands -->
				<div class="sticky top-0 z-30 flex" style="height:{HEADER_H}px">
					<div
						class="sticky left-0 z-10 flex items-end bg-zinc-50 px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:bg-zinc-950"
						style="width:{LABEL_W}px"
					>
						{STATIONS[life.slug].short} crew
					</div>
					<div class="relative flex-1 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
						{#each ticks as t (t.ms)}
							<div
								class="absolute top-1.5 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums {t.major
									? 'font-semibold text-zinc-600 dark:text-zinc-300'
									: 'text-zinc-400'}"
								style="left:{scale.x(t.ms)}px"
							>
								{t.label}
							</div>
						{/each}
						{#if nowX !== null}
							<div
								class="absolute top-1.5 -translate-x-1/2 rounded bg-emerald-500/15 px-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
								style="left:{nowX}px"
							>
								now
							</div>
						{/if}
						{#each expeditions as x, i (x.slug)}
							{@const g = span(Date.parse(x.start), endMs(x.end), 2)}
							<div
								class="absolute flex items-center overflow-hidden whitespace-nowrap border-l px-1 text-[11px] {x.slug === focus
									? 'border-sky-500 bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300'
									: i % 2
										? 'border-zinc-300 bg-zinc-200/60 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400'
										: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'} {x.ongoing ? 'station-ongoing' : ''}"
								style="left:{g.x}px; width:{g.w}px; top:{AXIS_H}px; height:{BAND_H - 2}px"
								title="{x.name}: {formatDate(x.start)} – {x.ongoing ? 'now' : formatDate(x.end)}"
							>
								{#if g.w > 44}{x.name}{/if}
							</div>
						{/each}
					</div>
				</div>

				<!-- rows -->
				{#each rows as row (row.person.slug)}
					{@const p = row.person}
					{@const color = colorFor(colorBy, valueOf(p, colorBy))}
					{@const selected = p.slug === selectedSlug}
					<div
						class="group flex cursor-pointer {selected ? 'bg-zinc-200/70 dark:bg-zinc-800/70' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'}"
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
							<Flags countries={p.nationalities} reserve={2} />
							<span class="truncate text-[13px] text-zinc-700 dark:text-zinc-200">{p.name}</span>
							{#if row.stays.some((r) => r.stay.ongoing)}
								<span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Aboard now"></span>
							{/if}
						</div>
						<div class="relative flex-1 border-b border-zinc-100/70 dark:border-zinc-900/70">
							{#each row.stays as r, i (i)}
								{@const g = span(Date.parse(r.stay.arrive), endMs(r.stay.depart), 3)}
								{@const visitor = r.stay.expeditions.length === 0}
								<div
									class="absolute top-1/2 -translate-y-1/2 rounded-[2px] {r.stay.ongoing ? 'station-ongoing' : ''}"
									style="left:{g.x}px; width:{g.w}px; height:{visitor ? 5 : 13}px; background:{color}; {r.stay.approx
										? 'opacity:0.6'
										: ''}"
									onmouseenter={(e) => (hover = { r, cx: e.clientX, cy: e.clientY })}
									onmousemove={(e) => (hover = { r, cx: e.clientX, cy: e.clientY })}
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
	{@const s = hover.r.stay}
	<div
		class="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
		style="left:{Math.min(hover.cx + 14, viewportW - 240)}px; top:{hover.cy + 14}px"
	>
		<div class="font-semibold text-zinc-800 dark:text-zinc-100">{hover.r.person.name}</div>
		<div class="mt-0.5 text-zinc-600 dark:text-zinc-300">
			{STATIONS[s.station].short} · {s.expeditions.length ? s.expeditions.map((x) => names.get(x) ?? x).join(', ') : 'Visitor'}
		</div>
		<div class="mt-1 flex items-center gap-1.5 text-zinc-500">
			<span>{formatDate(s.arrive)}</span>
			<span>→</span>
			<span>{s.ongoing ? 'now' : formatDate(s.depart)}</span>
		</div>
		<div class="mt-0.5 flex items-center gap-2 text-zinc-400">
			<span>{formatDuration(s.arrive, s.ongoing ? null : s.depart)} aboard</span>
			<span>·</span>
			<span>{hover.r.flight.mission}</span>
			{#if s.approx}<span>· approx.</span>{/if}
		</div>
	</div>
{/if}

<style>
	.station-ongoing {
		animation: station-pulse 2s ease-in-out infinite;
	}
	@keyframes station-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
</style>
