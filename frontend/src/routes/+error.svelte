<script lang="ts">
import { page } from "$app/state";
import { Button } from "$lib/components/ui/button";

// One joke per visit. Only the 404 gets jokes; real errors stay plain.
const JOKES = [
  { title: "This page was never developed.", line: "Like that film roll from 1998." },
  { title: "Someone tore this page out.", line: "We suspect the cat." },
  { title: "Nothing to see here.", line: "Literally. Not even a blurry thumb." },
  { title: "Lost between two pages.", line: "Happens to the best photos." },
  { title: "This photo is still in the camera.", line: "The camera is also lost." },
  { title: "Overexposed. Completely.", line: "Whatever was here, it's white now." },
];
const joke = JOKES[Math.floor(Math.random() * JOKES.length)] ?? JOKES[0];
</script>

{#if page.status === 404}
  <div class="flex flex-col items-center gap-6 py-12 text-center sm:py-20">
    <svg
      viewBox="0 0 220 200"
      class="w-56 max-w-full sm:w-64"
      role="img"
      aria-label="An empty polaroid dangling from a strip of tape, looking confused"
    >
      <!-- Shadow on the "table" -->
      <ellipse cx="110" cy="188" rx="58" ry="6" class="fill-muted-foreground/15" />

      <!-- The polaroid hangs from the tape and swings a little. -->
      <g class="swing">
        <rect
          x="52"
          y="26"
          width="116"
          height="140"
          rx="5"
          class="fill-card stroke-border"
          stroke-width="2"
        />
        <!-- Empty photo area -->
        <rect
          x="63"
          y="37"
          width="94"
          height="94"
          rx="3"
          class="fill-muted stroke-muted-foreground/40"
          stroke-width="1.5"
          stroke-dasharray="5 4"
        />
        <!-- Confused face -->
        <circle cx="94" cy="78" r="4" class="fill-muted-foreground/70" />
        <circle cx="126" cy="76" r="4" class="fill-muted-foreground/70" />
        <path
          d="M86 66 l12 -3"
          class="stroke-muted-foreground/70"
          stroke-width="2.5"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M96 104 q6 -6 12 0 t12 0"
          class="stroke-muted-foreground/70"
          stroke-width="2.5"
          stroke-linecap="round"
          fill="none"
        />
        <!-- Handwritten caption line on the polaroid's bottom strip -->
        <path
          d="M78 150 q10 -4 20 0 t20 0 t20 0"
          class="stroke-primary/50"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
        <!-- Tape -->
        <rect
          x="88"
          y="14"
          width="44"
          height="18"
          rx="2"
          class="fill-primary/60"
          transform="rotate(-4 110 23)"
        />
      </g>

      <!-- Floating question marks -->
      <text x="178" y="52" class="float fill-primary font-heading" font-size="34">?</text>
      <text x="26" y="84" class="float-late fill-primary/60 font-heading" font-size="22">?</text>
    </svg>

    <div class="grid gap-2">
      <p class="text-sm tracking-widest text-muted-foreground uppercase">404 · Page not found</p>
      <h1 class="font-heading text-3xl text-balance sm:text-4xl">{joke.title}</h1>
      <p class="text-muted-foreground">{joke.line}</p>
    </div>
    <Button href="/" variant="outline">Back to the library</Button>
  </div>
{:else}
  <div class="flex flex-col items-center gap-4 py-24 text-center">
    <p class="text-sm tracking-widest text-muted-foreground uppercase">{page.status}</p>
    <h1 class="font-heading text-3xl">{page.error?.message ?? 'Something went wrong'}</h1>
    <Button href="/" variant="outline">Back to the library</Button>
  </div>
{/if}

<style>
.swing {
  transform-box: view-box;
  transform-origin: 110px 20px;
  animation: swing 4s ease-in-out infinite;
}
.float {
  animation: float 3s ease-in-out infinite;
}
.float-late {
  animation: float 3s ease-in-out 1.2s infinite;
}
@keyframes swing {
  0%,
  100% {
    transform: rotate(-5deg);
  }
  50% {
    transform: rotate(3deg);
  }
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
    opacity: 1;
  }
  50% {
    transform: translateY(-6px);
    opacity: 0.6;
  }
}
@media (prefers-reduced-motion: reduce) {
  .swing,
  .float,
  .float-late {
    animation: none;
  }
  .swing {
    transform: rotate(-4deg);
  }
}
</style>
