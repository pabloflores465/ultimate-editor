<script lang="ts">
  import { onMount } from "svelte";
  import { router } from "svelte-spa-router";
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import EditorLayout from "./EditorLayout.svelte";
  import WorkspacePreviewFull from "./WorkspacePreviewFull.svelte";
  import WorkspaceOverview from "./WorkspaceOverview.svelte";

  let { children }: { children: import("svelte").Snippet } = $props();

  // ── Track state ────────────────────────────────────────────
  // trackX: current horizontal offset of the 3-panel strip (pixels)
  // In resting state: 0 (center panel = current workspace is visible)
  // Dragging right-to-left (going to next): trackX goes negative
  let trackX       = $state(0);
  let isAnimating  = $state(false);   // true during snap animation
  let isGesturing  = $state(false);   // true while finger is down / wheel active

  // Which adjacent workspaces to show in the side panels
  let prevWs = $derived(
    workspaceStore.workspaces[workspaceStore.activeIndex - 1] ?? null
  );
  let nextWs = $derived(
    workspaceStore.workspaces[workspaceStore.activeIndex + 1] ?? null
  );

  // Snap easing:
  //   · To new workspace:  ease-out  cubic-bezier(0, 0, 0.2, 1)  — Material Decelerate
  //   · Back (cancel):     spring    cubic-bezier(0.34, 1.56, 0.64, 1) — overshoot
  const EASE_OUT    = "cubic-bezier(0, 0, 0.2, 1)";
  const EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

  // CSS transition string applied during snapping, null while dragging
  let snapTransition = $state<string | null>(null);

  // Sync router → active workspace
  $effect(() => {
    const route = router.location ?? "/";
    workspaceStore.updateActive({ activeRoute: route });
  });

  // ── Snap logic ─────────────────────────────────────────────
  function snapTo(direction: "next" | "prev" | "back") {
    const vw = window.innerWidth;
    isAnimating = true;
    isGesturing = false;

    if (direction === "next") {
      snapTransition = `transform 360ms ${EASE_OUT}`;
      trackX = -vw;
      setTimeout(() => {
        // Workspace has fully slid out — now switch state
        workspaceStore.next();
        // Reset track instantly (no animation), new workspace is now center
        snapTransition = null;
        trackX = 0;
        isAnimating = false;
      }, 360);
    } else if (direction === "prev") {
      snapTransition = `transform 360ms ${EASE_OUT}`;
      trackX = vw;
      setTimeout(() => {
        workspaceStore.prev();
        snapTransition = null;
        trackX = 0;
        isAnimating = false;
      }, 360);
    } else {
      // Snap back with spring (user cancelled)
      snapTransition = `transform 420ms ${EASE_SPRING}`;
      trackX = 0;
      setTimeout(() => {
        snapTransition = null;
        isAnimating = false;
      }, 420);
    }
  }

  // ── Gesture helpers ─────────────────────────────────────────
  function isHScrollable(el: EventTarget | null, delta: number): boolean {
    let node = el as HTMLElement | null;
    while (node && node !== document.body) {
      const ov = window.getComputedStyle(node).overflowX;
      if ((ov === "auto" || ov === "scroll") && node.scrollWidth > node.clientWidth) {
        if (delta > 0 && node.scrollLeft < node.scrollWidth - node.clientWidth) return true;
        if (delta < 0 && node.scrollLeft > 0) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  // ── Mount all event listeners ──────────────────────────────
  onMount(() => {
    const vw = () => window.innerWidth;

    // ── WHEEL (trackpad 2-finger swipe) ──────────────────────
    // macOS / Windows precision trackpad: deltaX arrives as pixels
    // Classic mouse wheel: deltaX ≈ 0 (we skip those)
    let accumX   = 0;
    let velX     = 0;
    let lastTime = 0;
    let lastAcc  = 0;
    let wheelEnd: ReturnType<typeof setTimeout> | null = null;
    let cooldown = false;

    const onWheel = (e: WheelEvent) => {
      if (isAnimating || cooldown || workspaceStore.overviewOpen) return;
      // Skip mouse wheel (no horizontal component) and vertical-dominant scrolls
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 0.5) return;
      if (isHScrollable(e.target, e.deltaX)) return;

      const now = Date.now();
      const dt  = now - lastTime || 16;
      lastTime  = now;

      const px = e.deltaMode === 0 ? e.deltaX
               : e.deltaMode === 1 ? e.deltaX * 16
               : e.deltaX * 100;

      // Velocity in px/s (exponential smoothing)
      velX  = 0.7 * velX + 0.3 * (px / dt * 1000);
      accumX += px;
      isGesturing = true;

      // 1:1 track follows finger (with mild resistance past edge)
      const canGoNext = nextWs !== null;
      const canGoPrev = prevWs !== null;
      if ((!canGoNext && accumX > 0) || (!canGoPrev && accumX < 0)) {
        // Rubber-band: resistance 0.2 at the edges
        trackX = -accumX * 0.18;
      } else {
        trackX = -accumX;
      }

      // Wheel end detection — no new event for 120ms = finger lifted
      if (wheelEnd) clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => {
        isGesturing = false;
        const SNAP_DIST = vw() * 0.32;   // 32% of screen
        const SNAP_VEL  = 350;           // px/s

        if ((accumX > SNAP_DIST || velX > SNAP_VEL) && canGoNext) {
          cooldown = true;
          setTimeout(() => { cooldown = false; }, 700);
          snapTo("next");
        } else if ((accumX < -SNAP_DIST || velX < -SNAP_VEL) && canGoPrev) {
          cooldown = true;
          setTimeout(() => { cooldown = false; }, 700);
          snapTo("prev");
        } else {
          snapTo("back");
        }
        accumX = 0;
        velX   = 0;
      }, 120);
    };

    // ── TOUCH (touchscreen devices) ───────────────────────────
    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX  = 0;
    let touchLastT  = 0;
    let touchVelX   = 0;
    let touchAxis: "h" | "v" | null = null; // axis lock

    const onTouchStart = (e: TouchEvent) => {
      if (isAnimating || workspaceStore.overviewOpen) return;
      touchStartX = touchLastX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchLastT  = Date.now();
      touchVelX   = 0;
      touchAxis   = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isAnimating || workspaceStore.overviewOpen) return;
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = cx - touchStartX;
      const dy = cy - touchStartY;

      // Axis lock: decide on first significant movement
      if (!touchAxis && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        touchAxis = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
      }
      if (touchAxis !== "h") return;
      if (isHScrollable(e.target, dx)) return;

      const now = Date.now();
      const dt  = now - touchLastT || 16;
      touchVelX = 0.7 * touchVelX + 0.3 * ((cx - touchLastX) / dt * 1000);
      touchLastX = cx;
      touchLastT = now;

      isGesturing = true;

      const canGoNext = nextWs !== null;
      const canGoPrev = prevWs !== null;
      // dx > 0 = swiping right = going to prev workspace
      if ((!canGoNext && dx < 0) || (!canGoPrev && dx > 0)) {
        trackX = dx * 0.18; // rubber-band
      } else {
        trackX = dx;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchAxis !== "h" || workspaceStore.overviewOpen) return;
      isGesturing = false;

      const dx = e.changedTouches[0].clientX - touchStartX;
      const SNAP_DIST = vw() * 0.32;
      const SNAP_VEL  = 350;

      if ((dx < -SNAP_DIST || touchVelX < -SNAP_VEL) && nextWs !== null) {
        snapTo("next");
      } else if ((dx > SNAP_DIST || touchVelX > SNAP_VEL) && prevWs !== null) {
        snapTo("prev");
      } else {
        snapTo("back");
      }
    };

    // ── KEYBOARD ──────────────────────────────────────────────
    const onKeydown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;

      const ca = e.ctrlKey && e.altKey  && !e.shiftKey && !e.metaKey;
      const cs = e.ctrlKey && e.shiftKey && !e.altKey  && !e.metaKey;
      const esc = e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;

      if (ca && e.key === "ArrowRight") { e.preventDefault(); workspaceStore.next(); }
      if (ca && e.key === "ArrowLeft")  { e.preventDefault(); workspaceStore.prev(); }
      if (ca && (e.key === "n" || e.key === "N")) { e.preventDefault(); workspaceStore.addWorkspace(); }
      if (cs && e.key === "`")          { e.preventDefault(); workspaceStore.toggleOverview(); }
      if (esc && workspaceStore.overviewOpen) { e.preventDefault(); workspaceStore.toggleOverview(); }
    };

    window.addEventListener("wheel",      onWheel,      { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove",  onTouchMove,  { passive: true });
    window.addEventListener("touchend",   onTouchEnd,   { passive: true });
    window.addEventListener("keydown",    onKeydown);

    return () => {
      window.removeEventListener("wheel",      onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove",  onTouchMove);
      window.removeEventListener("touchend",   onTouchEnd);
      window.removeEventListener("keydown",    onKeydown);
      if (wheelEnd) clearTimeout(wheelEnd);
    };
  });

  // Keyboard/button switches: use {#key} slide animation (not the track)
  // These bypass the gesture track and go straight to the {#key} animation
</script>

<!-- ── Viewport ──────────────────────────────────────────────── -->
<div class="ws-viewport">

  <!--
    3-panel track: [ prev | current | next ]
    Each panel is 100vw wide, positioned at -100vw, 0, +100vw.
    trackX moves the whole strip:
      · Negative trackX → current slides left → next workspace comes in
      · Positive trackX → current slides right → prev workspace comes in

    During snapping: CSS transition is applied.
    During dragging: no transition (instant 1:1 tracking).
    When not gesturing AND not animating: trackX === 0, no overhead.
  -->
  <div
    class="ws-track"
    style:transform="translateX({trackX}px)"
    style:transition={snapTransition ?? "none"}
    style:will-change={isGesturing || isAnimating ? "transform" : "auto"}
  >
    <!-- PREV panel (left side, -100vw) -->
    <div class="ws-track__slot ws-track__slot--prev">
      {#if prevWs}
        <WorkspacePreviewFull ws={prevWs} />
      {:else}
        <!-- Edge: no prev workspace — show a subtle "no more" hint -->
        <div class="ws-track__edge ws-track__edge--prev">
          <span>← First workspace</span>
        </div>
      {/if}
    </div>

    <!-- CURRENT panel (center, 0) — always the live EditorLayout -->
    <div class="ws-track__slot ws-track__slot--current">
      {#key workspaceStore.transitionKey}
        <div
          class="ws-slide"
          class:ws-slide--enter-right={!isGesturing && !isAnimating && workspaceStore.slideDirection === 1}
          class:ws-slide--enter-left={!isGesturing && !isAnimating && workspaceStore.slideDirection === -1}
        >
          <EditorLayout
            ws={workspaceStore.active}
            onUpdate={(patch) => workspaceStore.updateActive(patch)}
            onOpenOverview={() => workspaceStore.toggleOverview()}
          >
            {@render children()}
          </EditorLayout>
        </div>
      {/key}
    </div>

    <!-- NEXT panel (right side, +100vw) -->
    <div class="ws-track__slot ws-track__slot--next">
      {#if nextWs}
        <WorkspacePreviewFull ws={nextWs} />
      {:else}
        <!-- Edge: no next workspace — rubber-band hint -->
        <div class="ws-track__edge ws-track__edge--next">
          <span>Last workspace →</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Gesture progress indicator dots (bottom center) -->
  {#if workspaceStore.workspaces.length > 1}
    <div class="ws-dots" class:ws-dots--visible={isGesturing || isAnimating}>
      {#each workspaceStore.workspaces as _, i}
        <div
          class="ws-dot"
          class:ws-dot--active={i === workspaceStore.activeIndex}
        ></div>
      {/each}
    </div>
  {/if}

</div>

<!-- Workspace overview overlay -->
{#if workspaceStore.overviewOpen}
  <WorkspaceOverview />
{/if}

<style>
  /* 3-panel track */
  .ws-track {
    position: absolute;
    top: 0;
    left: 0;
    /* Wide enough to hold prev + current + next */
    width: 300vw;
    height: 100vh;
    display: flex;
    /* Shift left by 100vw so "current" (the middle slot) aligns with viewport */
    margin-left: -100vw;
  }

  .ws-track__slot {
    width: 100vw;
    height: 100vh;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  }

  /* Edge plates (shown when no prev/next workspace exists) */
  .ws-track__edge {
    width: 100%;
    height: 100%;
    background: #1e1f21;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: #555759;
    letter-spacing: 1px;
  }

  /* Progress dots */
  .ws-dots {
    position: fixed;
    bottom: 48px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    align-items: center;
    z-index: 50;
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .ws-dots--visible {
    opacity: 1;
  }
  .ws-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    transition: background 200ms ease, transform 200ms ease;
  }
  .ws-dot--active {
    background: rgba(255, 255, 255, 0.85);
    transform: scale(1.3);
  }
</style>
