<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { GroupBackground, Photo } from '$lib/types';
	import { cn } from '$lib/utils';

	/**
	 * Wraps a group block's children with a border and an optional background.
	 * "auto" derives a hue from the group's gallery placeholders and renders it at
	 * a theme-controlled saturation/lightness (--tint-s / --tint-l in layout.css),
	 * so text stays readable; without photos it falls back to neutral.
	 */
	let {
		background = 'none',
		photos,
		children
	}: { background?: GroupBackground; photos: Photo[]; children: Snippet } = $props();

	const PRESETS: Record<string, string> = {
		neutral: 'bg-muted',
		blue: 'bg-sky-100 dark:bg-sky-950/60',
		green: 'bg-emerald-100 dark:bg-emerald-950/60',
		amber: 'bg-amber-100 dark:bg-amber-950/50',
		rose: 'bg-rose-100 dark:bg-rose-950/50'
	};

	let hue = $state<number | null>(null);

	$effect(() => {
		if (background !== 'auto') return;
		const srcs = photos
			.slice(0, 6)
			.map((p) => p.placeholder)
			.filter(Boolean);
		let cancelled = false;
		void Promise.all(srcs.map(averageColor)).then((colors) => {
			if (cancelled) return;
			const valid = colors.filter((c): c is [number, number, number] => c !== null);
			if (valid.length === 0) {
				hue = null;
				return;
			}
			const [r, g, b] = valid
				.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
				.map((v) => v / valid.length) as [number, number, number];
			hue = rgbToHue(r, g, b);
		});
		return () => {
			cancelled = true;
		};
	});

	const presetClass = $derived(
		background === 'auto' && hue === null ? PRESETS.neutral : (PRESETS[background] ?? '')
	);
	const autoStyle = $derived(
		background === 'auto' && hue !== null ? `hsl(${hue} var(--tint-s) var(--tint-l))` : undefined
	);

	// Average colour of a (tiny placeholder) image by downscaling it to 1×1.
	function averageColor(src: string): Promise<[number, number, number] | null> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = 1;
				canvas.height = 1;
				const ctx = canvas.getContext('2d');
				if (!ctx) return resolve(null);
				ctx.drawImage(img, 0, 0, 1, 1);
				const d = ctx.getImageData(0, 0, 1, 1).data;
				resolve([d[0] ?? 0, d[1] ?? 0, d[2] ?? 0]);
			};
			img.onerror = () => resolve(null);
			img.src = src;
		});
	}

	function rgbToHue(r: number, g: number, b: number): number {
		const [rn, gn, bn] = [r / 255, g / 255, b / 255];
		const max = Math.max(rn, gn, bn);
		const delta = max - Math.min(rn, gn, bn);
		if (delta === 0) return 0;
		let h: number;
		if (max === rn) h = ((gn - bn) / delta) % 6;
		else if (max === gn) h = (bn - rn) / delta + 2;
		else h = (rn - gn) / delta + 4;
		h = Math.round(h * 60);
		return h < 0 ? h + 360 : h;
	}
</script>

<div class={cn('my-8 border px-6 py-2 sm:px-8', presetClass)} style:background={autoStyle}>
	{@render children()}
</div>
