<script lang="ts">
  /**
   * WorkspaceSwitcher — macOS/GNOME/KDE-inspired workspace switching
   *
   * Design principles:
   *   · Gesture progress drives position 1:1 (no threshold before movement starts)
   *   · Axis lock: decide horizontal vs vertical on first significant movement
   *   · Snap to workspace if distance > 28% vw OR velocity > 350 px/s (flick)
   *   · Spring physics (rAF) for all gesture-initiated transitions:
   *       – Snap inherits gesture velocity → fast flick = instant-feeling snap
   *       – Cancel uses critically-damped spring → clean, direct return with no bounce
   *   · CSS transition for keyboard shortcuts (deliberate, no prior velocity)
   *   · Immediate commit on clear flick/threshold (no 80ms wait)
   *   · No {#key} re-creation — EditorLayout stays mounted, only props update
   *
   * Track layout (3 slots, absolute-positioned):
   *   [ PREV at x=-100vw ] [ CURRENT at x=0 ] [ NEXT at x=+100vw ]
   *   translateX(trackX) shifts the whole container:
   *     trackX < 0 → current slides left, next appears from right
   *     trackX > 0 → current slides right, prev appears from left
   *
   * macOS natural scroll (default, fingers move LEFT = deltaX negative):
   *   Swipe left → going next → accumX negative → trackX negative ✓
   */

  import { onMount } from "svelte";
  import { router } from "svelte-spa-router";
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import EditorLayout from "./EditorLayout.svelte";
  import WorkspacePreviewFull from "./WorkspacePreviewFull.svelte";
  import WorkspaceOverview from "./WorkspaceOverview.svelte";
  import WorkspaceTabBar from "./WorkspaceTabBar.svelte";

  let { children }: { children: import("svelte").Snippet } = $props();

  // ── Tiling drop-zone state ─────────────────────────────────
  let dropZoneHover = $state<"left" | "right" | "top" | "bottom" | null>(null);

  function onZoneDragOver(e: DragEvent, zone: "left" | "right" | "top" | "bottom") {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    dropZoneHover = zone;
  }

  function onZoneDrop(e: DragEvent, zone: "left" | "right" | "top" | "bottom") {
    e.preventDefault();
    const idx = workspaceStore.tilingDragWsIdx;
    if (idx !== null) {
      workspaceStore.placeTiledWorkspace(idx, zone);
    }
    dropZoneHover = null;
  }

  function onZoneDragLeave() {
    dropZoneHover = null;
  }

  // ── Track position ─────────────────────────────────────────
  let trackX      = $state(0);             // translateX applied to the 3-slot container
  let trackCss    = $state<string>("none"); // CSS transition (none during spring/drag)
  let busy        = $state(false);          // locked during animated snap
  let gestureDir  = $state<0 | 1 | -1>(0); // 0=idle  1=going-next  -1=going-prev

  // Adjacent workspaces (for side panels)
  let prevWs = $derived(workspaceStore.workspaces[workspaceStore.activeIndex - 1] ?? null);
  let nextWs = $derived(workspaceStore.workspaces[workspaceStore.activeIndex + 1] ?? null);

  // Side panels only need to be in DOM while the user is gesturing toward them
  let showPrev = $derived(gestureDir === -1 || trackX > 4);
  let showNext = $derived(gestureDir ===  1 || trackX < -4);

  // Sync router → active workspace's remembered route
  $effect(() => { workspaceStore.updateActive({ activeRoute: router.location ?? "/" }); });

  // ── CSS constants (keyboard shortcuts only) ─────────────────
  const DUR_SNAP    = 260;
  const DUR_SPRING  = 380;
  const EASE_SNAP   = "cubic-bezier(0.25, 0.46, 0.45, 0.94)"; // ease-out-quad
  const EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";    // spring with slight overshoot

  // ── Spring physics constants ────────────────────────────────
  // Snap:   critically damped → no overshoot, fast.  ζ = 57/(2√800) ≈ 1.0
  // Cancel: slightly overdamped (KDE-style, ζ=1.1) → smooth return, no bounce.
  //         b = 2·√k·ζ = 2·√300·1.1 ≈ 38.1
  const SNAP_K = 800;
  const SNAP_B = 57;
  const BACK_K = 300;
  const BACK_B = 38;

  // ── Momentum guard ─────────────────────────────────────────
  // macOS trackpads keep firing momentum scroll events for 1–2s after the
  // gesture ends.  After any snap completes we record a timestamp; the wheel
  // handler ignores events that arrive within this window.  This does NOT
  // block keyboard shortcuts (goNext/goPrev) — only wheel-driven gestures.
  let lastSnapAt = 0;
  const MOMENTUM_GUARD_MS = 500;

  // ── Spring animation engine ─────────────────────────────────
  let rafId: number | null = null;

  function killAnim() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  /**
   * Animate trackX to `target` using spring physics.
   * Inherits `initVel` (px/s) from the gesture so the motion feels continuous.
   *
   *   acc = −k·(pos − target) − b·vel   (semi-implicit Euler, stable)
   */
  function springTo(
    target: number,
    initVel: number,
    k: number,
    b: number,
    onDone: () => void,
  ) {
    killAnim();
    trackCss = "none";

    let pos  = trackX;
    let vel  = initVel;
    let last = -1;

    rafId = requestAnimationFrame(function tick(t: number) {
      if (last < 0) { last = t; rafId = requestAnimationFrame(tick); return; }

      const dt  = Math.min((t - last) / 1000, 0.033); // cap at ~30 fps minimum
      last = t;

      const acc = -k * (pos - target) - b * vel;
      vel += acc * dt;
      pos += vel * dt;
      trackX = pos;

      // Settled?
      if (Math.abs(pos - target) < 1.5 && Math.abs(vel) < 40) {
        trackX = target;
        rafId  = null;
        onDone();
        return;
      }

      rafId = requestAnimationFrame(tick);
    });
  }

  // ── Gesture-initiated snaps (spring, inherit velocity) ──────
  function doSnapNext(vel: number) {
    if (busy || !nextWs) { doSnapBack(vel); return; }
    busy = true;
    gestureDir = 1;
    springTo(-window.innerWidth, vel, SNAP_K, SNAP_B, () => {
      workspaceStore.next();
      trackX     = 0;
      gestureDir = 0;
      busy       = false;
      lastSnapAt = Date.now();
    });
  }

  function doSnapPrev(vel: number) {
    if (busy || !prevWs) { doSnapBack(vel); return; }
    busy = true;
    gestureDir = -1;
    springTo(window.innerWidth, vel, SNAP_K, SNAP_B, () => {
      workspaceStore.prev();
      trackX     = 0;
      gestureDir = 0;
      busy       = false;
      lastSnapAt = Date.now();
    });
  }

  function doSnapBack(vel: number) {
    busy = true;
    springTo(0, vel, BACK_K, BACK_B, () => {
      gestureDir = 0;
      busy       = false;
      lastSnapAt = Date.now();
    });
  }

  // ── Keyboard snaps (CSS transition, deliberate pace) ────────
  function goNext() {
    if (busy || !nextWs) return;
    busy = true;
    gestureDir = 1;
    trackCss   = `transform ${DUR_SNAP}ms ${EASE_SNAP}`;
    trackX     = -window.innerWidth;
    setTimeout(() => {
      workspaceStore.next();
      trackCss   = "none";
      trackX     = 0;
      gestureDir = 0;
      busy       = false;
    }, DUR_SNAP);
  }

  function goPrev() {
    if (busy || !prevWs) return;
    busy = true;
    gestureDir = -1;
    trackCss   = `transform ${DUR_SNAP}ms ${EASE_SNAP}`;
    trackX     = window.innerWidth;
    setTimeout(() => {
      workspaceStore.prev();
      trackCss   = "none";
      trackX     = 0;
      gestureDir = 0;
      busy       = false;
    }, DUR_SNAP);
  }

  // ── Gesture helpers ────────────────────────────────────────
  /** Walk up DOM: is any ancestor scrollable horizontally with room in `dir`? */
  function consumedByScroll(el: EventTarget | null, dir: number): boolean {
    let node = el as HTMLElement | null;
    while (node && node !== document.body) {
      const ov = window.getComputedStyle(node).overflowX;
      if ((ov === "auto" || ov === "scroll") && node.scrollWidth > node.clientWidth + 2) {
        if (dir > 0 && node.scrollLeft < node.scrollWidth - node.clientWidth - 1) return true;
        if (dir < 0 && node.scrollLeft > 1) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  // ── Mount event listeners ──────────────────────────────────
  onMount(() => {
    // ── WHEEL GESTURE (trackpad 2-finger swipe) ──────────────
    //
    // State machine matching GNOME's approach:
    //   IDLE     → gather first events, decide axis
    //   H_LOCK   → horizontal gesture in progress, apply to track 1:1
    //   V_LOCK   → vertical scroll, pass through to browser
    //   COOLDOWN → just completed a switch, ignore events briefly

    type Phase = "idle" | "h-lock" | "v-lock" | "cooldown";
    let phase: Phase   = "idle";
    let gx             = 0;       // accumulated horizontal delta this gesture
    let velX           = 0;       // EMA velocity px/s
    let lastT          = 0;       // timestamp of last wheel event
    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;

    const normDelta = (e: WheelEvent, axis: "x" | "y"): number => {
      const raw = axis === "x" ? e.deltaX : e.deltaY;
      return e.deltaMode === 0 ? raw : e.deltaMode === 1 ? raw * 16 : raw * 100;
    };

    const onWheel = (e: WheelEvent) => {
      if (workspaceStore.overviewOpen) return;

      const now   = Date.now();
      const px    = normDelta(e, "x");
      const py    = normDelta(e, "y");
      const prevT = lastT;
      const dt    = Math.max(now - prevT, 4);
      lastT = now;

      // New gesture? Reset if wheel was idle for >350ms
      if (now - prevT > 350 && phase !== "cooldown") {
        phase = "idle";
        gx = 0; velX = 0;
      }

      // Absorb residual macOS momentum scroll events after any snap
      if (now - lastSnapAt < MOMENTUM_GUARD_MS) return;

      // ── Axis lock decision ───────────────────────────────
      if (phase === "idle") {
        const absX = Math.abs(px), absY = Math.abs(py);
        if (absX + absY < 2) return; // too weak to decide
        if (absX >= absY * 0.7) {
          if (!consumedByScroll(e.target, px)) {
            // Allow interrupting a running spring so user can grab mid-animation
            if (rafId !== null) { killAnim(); busy = false; }
            phase = "h-lock";
          } else {
            phase = "v-lock";
          }
        } else {
          phase = "v-lock"; // clearly vertical
        }
      }

      if (phase === "v-lock" || phase === "cooldown" || busy) return;

      // ── Apply horizontal movement ─────────────────────────
      // macOS natural scroll ON (default): swipe LEFT → px negative → gx negative
      // trackX = gx so track moves left (negative) → next workspace visible ✓
      e.preventDefault(); // we own this gesture — prevent page scroll
      gx += px;
      // Cap accumulation to ±1 screen width — prevents momentum-scroll events
      // (macOS keeps firing after finger lift) from pushing gx way past the target
      const maxGx = window.innerWidth;
      gx = Math.max(-maxGx, Math.min(maxGx, gx));

      velX = velX * 0.6 + (px / dt * 1000) * 0.4; // EMA velocity (px/s)

      gestureDir = gx < -8 ? 1 : gx > 8 ? -1 : 0;

      // Hard clamp at edges (no adjacent workspace) — same as GNOME/KDE.
      // No rubber-band, no movement. Just a wall.
      if (gx < 0 && !nextWs) { gx = 0; trackX = 0; return; }
      if (gx > 0 && !prevWs) { gx = 0; trackX = 0; return; }

      trackX = gx; // 1:1 — workspace sticks to finger

      // ── Immediate commit on clear flick or large drag ─────
      // Don't wait for the 80ms silence timer when intent is unambiguous.
      // Threshold: velocity > 600 px/s  OR  distance > 50% vw
      const SNAP_DIST     = window.innerWidth * 0.28;
      const SNAP_VEL      = 350;
      const FLICK_VEL     = 600;   // instant-commit velocity
      const EAGER_DIST    = window.innerWidth * 0.50; // instant-commit distance

      const commitNext = (velX < -FLICK_VEL && gx < -15) || (gx < -EAGER_DIST);
      const commitPrev = (velX >  FLICK_VEL && gx >  15) || (gx >  EAGER_DIST);

      if ((commitNext && nextWs) || (commitPrev && prevWs)) {
        if (wheelEndTimer) clearTimeout(wheelEndTimer);
        phase = "cooldown";
        setTimeout(() => { phase = "idle"; }, 600);
        if (commitNext) doSnapNext(velX);
        else            doSnapPrev(velX);
        gx = 0; velX = 0;
        return;
      }

      // ── Schedule "gesture ended" detection ───────────────
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
      wheelEndTimer = setTimeout(() => {
        if (phase !== "h-lock") return;
        phase = "idle";

        if ((gx < -SNAP_DIST || velX < -SNAP_VEL) && nextWs) {
          phase = "cooldown";
          setTimeout(() => { phase = "idle"; }, 600);
          doSnapNext(velX);
        } else if ((gx > SNAP_DIST || velX > SNAP_VEL) && prevWs) {
          phase = "cooldown";
          setTimeout(() => { phase = "idle"; }, 600);
          doSnapPrev(velX);
        } else {
          doSnapBack(velX);
        }
        gx = 0; velX = 0;
      }, endDelay);
    };

    // ── TOUCH SWIPE ───────────────────────────────────────────
    let tx0 = 0, ty0 = 0, txLast = 0, tLast = 0, tvX = 0;
    type TouchAxis = null | "h" | "v";
    let tAxis: TouchAxis = null;

    const onTouchStart = (e: TouchEvent) => {
      if (busy || workspaceStore.overviewOpen) return;
      tx0 = txLast = e.touches[0].clientX;
      ty0 = e.touches[0].clientY;
      tLast = Date.now();
      tvX = 0; tAxis = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (busy || workspaceStore.overviewOpen) return;
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = cx - tx0, dy = cy - ty0;
      const now = Date.now();
      const dt = Math.max(now - tLast, 4);

      // Axis lock
      if (!tAxis && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        tAxis = Math.abs(dx) >= Math.abs(dy) * 0.75 ? "h" : "v";
      }
      if (tAxis !== "h") return;
      if (consumedByScroll(e.target, -dx)) return; // touch: dx positive = swiping right = going prev, negate for scroll check
      e.preventDefault(); // prevent page scroll during horizontal swipe

      tvX = tvX * 0.6 + ((cx - txLast) / dt * 1000) * 0.4;
      txLast = cx;
      tLast = now;

      // Touch: dx positive = finger moved right = going to PREV workspace
      gestureDir = dx < -8 ? 1 : dx > 8 ? -1 : 0;
      // Hard clamp at edges
      if (dx < 0 && !nextWs) { trackX = 0; return; }
      if (dx > 0 && !prevWs) { trackX = 0; return; }
      trackX = dx; // For touch: dx same sign as visual movement (+ = right = prev)
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (tAxis !== "h" || workspaceStore.overviewOpen) return;
      const dx  = e.changedTouches[0].clientX - tx0;
      const SD  = window.innerWidth * 0.28;
      const SV  = 350;
      if ((dx < -SD || tvX < -SV) && nextWs)      doSnapNext(tvX);
      else if ((dx >  SD || tvX >  SV) && prevWs) doSnapPrev(tvX);
      else                                          doSnapBack(tvX);
      tAxis = null;
    };

    // ── KEYBOARD ──────────────────────────────────────────────
    const onKeydown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;

      const ca  = e.ctrlKey && e.altKey   && !e.shiftKey && !e.metaKey;
      const cs  = e.ctrlKey && e.shiftKey && !e.altKey   && !e.metaKey;
      const esc = e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;

      if (ca && e.key === "ArrowRight")             { e.preventDefault(); goNext(); }
      else if (ca && e.key === "ArrowLeft")         { e.preventDefault(); goPrev(); }
      else if (ca && (e.key === "n" || e.key === "N")) { e.preventDefault(); workspaceStore.addWorkspace(); }
      else if (cs && e.key === "`")                 { e.preventDefault(); workspaceStore.toggleOverview(); }
      else if (esc && workspaceStore.overviewOpen)  { e.preventDefault(); workspaceStore.toggleOverview(); }
    };

    window.addEventListener("wheel",      onWheel,      { passive: false }); // passive:false so we can preventDefault during h-lock
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove",  onTouchMove,  { passive: false }); // passive:false so we can preventDefault during h-swipe
    window.addEventListener("touchend",   onTouchEnd,   { passive: true });
    window.addEventListener("keydown",    onKeydown);

    return () => {
      window.removeEventListener("wheel",      onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove",  onTouchMove);
      window.removeEventListener("touchend",   onTouchEnd);
      window.removeEventListener("keydown",    onKeydown);
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
    };
  });
</script>

<!-- ── Workspace tab bar ──────────────────────────────────── -->
<WorkspaceTabBar />

{#if workspaceStore.tilingLayout !== "single"}
  <!-- ── Tiled workspace view ──────────────────────────────── -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="ws-tiled"
    style:display={workspaceStore.tilingLayout === "quarter" ? "grid" : "flex"}
    style:grid-template-columns={workspaceStore.tilingLayout === "quarter" ? "1fr 1fr" : undefined}
    style:grid-template-rows={workspaceStore.tilingLayout === "quarter" ? "1fr 1fr" : undefined}
    style:flex-direction={workspaceStore.tilingLayout === "hsplit" ? "column" : "row"}
  >
    {#each workspaceStore.tiledIndices as wsIdx, tileIdx}
      {@const tileWs = workspaceStore.workspaces[wsIdx]}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="ws-tile"
        class:ws-tile--focused={workspaceStore.tiledFocus === tileIdx}
        onclick={() => workspaceStore.focusTile(tileIdx)}
      >
        <EditorLayout
          ws={tileWs}
          onUpdate={(patch) => workspaceStore.updateWorkspace(wsIdx, patch)}
          onOpenOverview={() => workspaceStore.toggleOverview()}
        >
          {@render children()}
        </EditorLayout>
      </div>
    {/each}
  </div>

{:else}
  <!-- ── Single workspace (3-slot animated switcher) ───────── -->
  <div class="ws-viewport">
    <div
      class="ws-container"
      style:transform="translateX({trackX}px)"
      style:transition={trackCss}
      style:will-change={busy || gestureDir !== 0 ? "transform" : "auto"}
    >
      <!-- PREV slot -->
      <div class="ws-slot ws-slot--prev">
        {#if showPrev && prevWs}
          <WorkspacePreviewFull ws={prevWs} />
        {:else if showPrev}
          <div class="ws-edge">← First workspace</div>
        {/if}
      </div>

      <!-- CURRENT slot — always live, no {#key} re-creation -->
      <div class="ws-slot ws-slot--current">
        <EditorLayout
          ws={workspaceStore.active}
          onUpdate={(patch) => workspaceStore.updateActive(patch)}
          onOpenOverview={() => workspaceStore.toggleOverview()}
        >
          {@render children()}
        </EditorLayout>
      </div>

      <!-- NEXT slot -->
      <div class="ws-slot ws-slot--next">
        {#if showNext && nextWs}
          <WorkspacePreviewFull ws={nextWs} />
        {:else if showNext}
          <div class="ws-edge">Last workspace →</div>
        {/if}
      </div>
    </div>

  </div>
{/if}

<!-- Tiling drop-zone overlay (shown while dragging a workspace tab) -->
{#if workspaceStore.tilingDragWsIdx !== null}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tile-drop-overlay">
    <!-- LEFT zone -->
    <div
      class="tile-zone tile-zone--left"
      class:tile-zone--active={dropZoneHover === "left"}
      ondragover={(e) => onZoneDragOver(e, "left")}
      ondragleave={onZoneDragLeave}
      ondrop={(e) => onZoneDrop(e, "left")}
    >
      <div class="tile-zone-preview tile-zone-preview--left">
        <div class="tzp-a tzp-accent"></div>
        <div class="tzp-b"></div>
      </div>
    </div>

    <!-- RIGHT zone -->
    <div
      class="tile-zone tile-zone--right"
      class:tile-zone--active={dropZoneHover === "right"}
      ondragover={(e) => onZoneDragOver(e, "right")}
      ondragleave={onZoneDragLeave}
      ondrop={(e) => onZoneDrop(e, "right")}
    >
      <div class="tile-zone-preview tile-zone-preview--right">
        <div class="tzp-a"></div>
        <div class="tzp-b tzp-accent"></div>
      </div>
    </div>

    <!-- TOP zone -->
    <div
      class="tile-zone tile-zone--top"
      class:tile-zone--active={dropZoneHover === "top"}
      ondragover={(e) => onZoneDragOver(e, "top")}
      ondragleave={onZoneDragLeave}
      ondrop={(e) => onZoneDrop(e, "top")}
    >
      <div class="tile-zone-preview tile-zone-preview--top">
        <div class="tzp-a tzp-accent"></div>
        <div class="tzp-b"></div>
      </div>
    </div>

    <!-- BOTTOM zone -->
    <div
      class="tile-zone tile-zone--bottom"
      class:tile-zone--active={dropZoneHover === "bottom"}
      ondragover={(e) => onZoneDragOver(e, "bottom")}
      ondragleave={onZoneDragLeave}
      ondrop={(e) => onZoneDrop(e, "bottom")}
    >
      <div class="tile-zone-preview tile-zone-preview--bottom">
        <div class="tzp-a"></div>
        <div class="tzp-b tzp-accent"></div>
      </div>
    </div>
  </div>
{/if}

<!-- Overview overlay -->
{#if workspaceStore.overviewOpen}
  <WorkspaceOverview />
{/if}

<style>
  /* 3-slot container fills the viewport; slots hang off the sides */
  .ws-container {
    position: absolute;
    inset: 0;
  }

  .ws-slot {
    position: absolute;
    top: 0;
    width: 100vw;
    height: 100%;
    overflow: hidden;
  }
  .ws-slot--prev    { left: -100vw; }
  .ws-slot--current { left: 0; }
  .ws-slot--next    { left:  100vw; }

  /* Edge plates */
  .ws-edge {
    width: 100%;
    height: 100%;
    background: #1a1b1d;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: #555759;
    letter-spacing: 1px;
  }

  /* ── Tiling drop-zone overlay ──────────────────────────────── */
  .tile-drop-overlay {
    position: fixed;
    top: 38px; /* below tab bar */
    left: 0; right: 0; bottom: 0;
    z-index: 500;
    pointer-events: none;
  }

  .tile-zone {
    position: absolute;
    pointer-events: all;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.55;
    transition: opacity 140ms ease, background 140ms ease;
  }

  /* Zone geometry — cross pattern, no corner overlaps */
  .tile-zone--left   { left: 0;   top: 0; bottom: 0; width: 18%; }
  .tile-zone--right  { right: 0;  top: 0; bottom: 0; width: 18%; }
  .tile-zone--top    { top: 0;    left: 18%; right: 18%; height: 18%; }
  .tile-zone--bottom { bottom: 0; left: 18%; right: 18%; height: 18%; }

  .tile-zone--active {
    opacity: 1;
    background: rgba(78, 155, 222, 0.12);
  }

  /* Mini preview icon — two rectangles showing how the split will look */
  .tile-zone-preview {
    display: flex;
    gap: 3px;
    padding: 6px;
    background: rgba(30, 31, 34, 0.82);
    border: 1.5px solid rgba(78, 155, 222, 0.35);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .tile-zone--active .tile-zone-preview {
    border-color: rgba(78, 155, 222, 0.75);
    background: rgba(30, 31, 34, 0.92);
  }

  /* Horizontal split (left/right) */
  .tile-zone-preview--left,
  .tile-zone-preview--right {
    flex-direction: row;
    width: 36px;
    height: 26px;
  }
  .tile-zone-preview--left  .tzp-a,
  .tile-zone-preview--left  .tzp-b,
  .tile-zone-preview--right .tzp-a,
  .tile-zone-preview--right .tzp-b {
    flex: 1;
    border-radius: 2px;
    background: #3c3f41;
  }

  /* Vertical split (top/bottom) */
  .tile-zone-preview--top,
  .tile-zone-preview--bottom {
    flex-direction: column;
    width: 26px;
    height: 36px;
  }
  .tile-zone-preview--top  .tzp-a,
  .tile-zone-preview--top  .tzp-b,
  .tile-zone-preview--bottom .tzp-a,
  .tile-zone-preview--bottom .tzp-b {
    flex: 1;
    border-radius: 2px;
    background: #3c3f41;
  }

  /* Accent = the pane where the dragged workspace will land */
  .tzp-accent {
    background: #4e7bf0 !important;
    opacity: 0.85;
  }

</style>
