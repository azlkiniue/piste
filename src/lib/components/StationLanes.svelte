<script lang="ts">
	import { STATIONS } from '$lib/stations';
	import type { Expedition, StationLife } from '$lib/types';
	import { makeScale, timeTicks, formatDate, formatDuration, DAY, YEAR } from '$lib/time-scale';
	import { colorFor, valueOf } from '$lib/colors';
	import { personColour, type ColourChoice } from '$lib/colour.svelte';
	import { endMs, expeditionKey, type StayRow } from '$lib/station-index';
	import Flags from './Flags.svelte';

	interface Props {
		lives: StationLife[];
		expeditions: Expedition[];
		/** Each Expedition's crew, keyed by expeditionKey. */
		crew: Map<string, StayRow[]>;
		/** "expedition" draws each Expedition in neutral shades; a person dimension stripes it, one stripe per crew member. */
		colourBy: ColourChoice;
		/** A value of that dimension to pick out: every other stripe fades. */
		highlight?: string | null;
		/** Where a lane's label, and each Expedition, lead — the station view. */
		stationHref?: (slug: string) => string;
		expeditionHref?: (x: Expedition) => string;
	}
	let { lives, expeditions, crew, colourBy, highlight = null, stationHref, expeditionHref }: Props = $props();

	const LABEL_W = 150;
	const LANE_H = 44;
	const HEADER_H = 30;
	const BAR_H = 18;

	let viewportW = $state(1000);
	let zoom = $state(0); // px-per-year; 0 means "fit"

	const minMs = Date.UTC(1971, 0, 1);
	const maxMs = Date.now() + 150 * DAY;
	const totalYears = (maxMs - minMs) / YEAR;

	const fitPxPerYear = $derived(Math.max(3, (viewportW - LABEL_W - 14) / totalYears));
	const pxPerYear = $derived(zoom || fitPxPerYear);
	const plotW = $derived(Math.max(240, totalYears * pxPerYear));
	const scale = $derived(makeScale(minMs, maxMs, plotW));
	const ticks = $derived(timeTicks(minMs, maxMs, pxPerYear));
	const nowX = $derived(scale.x(Date.now()));

	const byStation = $derived.by(() => {
		const m = new Map<string, Expedition[]>();
		for (const x of expeditions) m.set(x.station, [...(m.get(x.station) ?? []), x]);
		return m;
	});
	const stripes = $derived(colourBy === 'expedition' ? null : personColour(colourBy));

	function span(start: string, end: string | null, min = 2) {
		const x = scale.x(Date.parse(start));
		return { x, w: Math.max(min, scale.x(endMs(end)) - x) };
	}
	const years = (l: StationLife) =>
		`${l.launched.slice(0, 4)}–${l.deorbited ? (l.deorbited.slice(0, 2) === l.launched.slice(0, 2) ? l.deorbited.slice(2, 4) : l.deorbited.slice(0, 4)) : 'now'}`;

	// zoom around the horizontal centre of the viewport
	let scrollEl = $state<HTMLDivElement>();
	function setZoom(next: number) {
		const el = scrollEl;
		const centerMs = el ? scale.invertX(el.scrollLeft + (el.clientWidth - LABEL_W) / 2) : minMs;
		zoom = Math.min(400, Math.max(fitPxPerYear, next));
		requestAnimationFrame(() => {
			if (!el) return;
			const ns = makeScale(minMs, maxMs, Math.max(240, totalYears * (zoom || fitPxPerYear)));
			el.scrollLeft = ns.x(centerMs) - (el.clientWidth - LABEL_W) / 2;
		});
	}

	let hover = $state<{ x: Expedition; rows: StayRow[]; cx: number; cy: number } | null>(null);
</script>

<div class="flex h-full flex-col">
	<!-- toolbar -->
	<div
		class="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
	>
		<span>Each bar is an Expedition — a Station's resident crew{stripes ? ', one stripe per crew member' : ''}</span>
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
				disabled={pxPerYear >= 400}
				aria-label="Zoom in">+</button
			>
		</div>
	</div>

	<div bind:this={scrollEl} bind:clientWidth={viewportW} class="scrollbar-thin relative flex-1 overflow-auto">
		<div class="relative" style="width:{LABEL_W + plotW}px; height:{HEADER_H + lives.length * LANE_H}px">
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
					Station
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

			<!-- lanes -->
			{#each lives as life (life.slug)}
				{@const station = STATIONS[life.slug]}
				{@const track = span(life.launched, life.deorbited)}
				<div class="flex" style="height:{LANE_H}px">
					<svelte:element
						this={stationHref ? 'a' : 'div'}
						href={stationHref?.(life.slug)}
						class="sticky left-0 z-20 flex flex-col justify-center overflow-hidden border-b border-zinc-100 bg-zinc-50 px-3 dark:border-zinc-900 dark:bg-zinc-950 {stationHref
							? 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
							: ''}"
						style="width:{LABEL_W}px"
						title={station.name ? `${station.name} — ${station.note}` : station.note}
					>
						<span class="truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{station.short}</span>
						<span class="text-[11px] tabular-nums text-zinc-400">{years(life)}</span>
					</svelte:element>
					<div class="relative flex-1 border-b border-zinc-100/70 dark:border-zinc-900/70">
						<div
							class="absolute rounded-[3px] bg-zinc-200/80 dark:bg-zinc-800/80"
							style="left:{track.x}px; width:{track.w}px; top:{(LANE_H - BAR_H) / 2 + 4}px; height:{BAR_H - 8}px"
							title="{station.short} in orbit, {formatDate(life.launched)} – {life.deorbited ? formatDate(life.deorbited) : 'now'}"
						></div>
						{#each byStation.get(life.slug) ?? [] as x, i (x.slug)}
							{@const g = span(x.start, x.end)}
							{@const rows = crew.get(expeditionKey(x.station, x.slug)) ?? []}
							{@const values = stripes ? rows.map((r) => valueOf(r.person, stripes)) : []}
							{@const faded = !!stripes && !!highlight && !values.includes(highlight)}
							<svelte:element
								this={expeditionHref ? 'a' : 'div'}
								href={expeditionHref?.(x)}
								class="absolute flex flex-col overflow-hidden rounded-[2px] ring-1 ring-zinc-50 transition-opacity dark:ring-zinc-950 {x.ongoing
									? 'station-ongoing'
									: ''} {stripes ? '' : i % 2 ? 'bg-zinc-500 dark:bg-zinc-400' : 'bg-zinc-400 dark:bg-zinc-500'} {faded
									? 'opacity-25'
									: ''}"
								style="left:{g.x}px; width:{g.w}px; top:{(LANE_H - BAR_H) / 2}px; height:{BAR_H}px"
								onmouseenter={(e: MouseEvent) => (hover = { x, rows, cx: e.clientX, cy: e.clientY })}
								onmousemove={(e: MouseEvent) => (hover = { x, rows, cx: e.clientX, cy: e.clientY })}
								onmouseleave={() => (hover = null)}
								role={expeditionHref ? undefined : 'presentation'}
								aria-label={expeditionHref ? `${x.name}, ${station.short}` : undefined}
							>
								{#each values as v, j (j)}
									<div
										class="min-h-0 flex-1 {highlight && v !== highlight ? 'opacity-25' : ''}"
										style="background:{colorFor(stripes!, v)}"
									></div>
								{/each}
							</svelte:element>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

{#if hover}
	<div
		class="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
		style="left:{Math.min(hover.cx + 14, viewportW - 240)}px; top:{hover.cy + 14}px"
	>
		<div class="font-semibold text-zinc-800 dark:text-zinc-100">{hover.x.name}</div>
		<div class="text-zinc-500">{STATIONS[hover.x.station].short}</div>
		<div class="mt-1 flex items-center gap-1.5 text-zinc-500">
			<span>{formatDate(hover.x.start)}</span>
			<span>→</span>
			<span>{hover.x.ongoing ? 'now' : formatDate(hover.x.end)}</span>
			<span class="text-zinc-400">· {formatDuration(hover.x.start, hover.x.ongoing ? null : hover.x.end)}</span>
		</div>
		<ul class="mt-1.5 space-y-0.5">
			{#each hover.rows as r (r.person.slug)}
				<li class="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
					<Flags countries={r.person.nationalities} reserve={2} />
					<span class="truncate">{r.person.name}</span>
				</li>
			{/each}
		</ul>
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
