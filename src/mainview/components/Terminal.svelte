<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";

  // ── Props ──────────────────────────────────────────────────────────────────
  let {
    onInput,
    onResize,
    onMounted,
    fullscreen = $bindable(false),
  }: {
    onInput: (b64: string) => void;
    onResize: (cols: number, rows: number) => void;
    onMounted: (writeFn: (b64: string) => void) => void;
    fullscreen?: boolean;
  } = $props();

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let term: Terminal | undefined;
  let fitAddon: FitAddon | undefined;

  onMount(() => {
    if (!containerEl) return;

    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.0,
      letterSpacing: 0,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
      allowProposedApi: true,
      scrollback: 10000,
      theme: {
        background: "#1e1f22",
        foreground: "#a9b7c6",
        cursor:     "#a9b7c6",
        cursorAccent: "#1e1f22",
        black:   "#3d3d3d", red:     "#cc0000", green:   "#4e9a06", yellow:  "#c4a000",
        blue:    "#3465a4", magenta: "#75507b", cyan:    "#06989a", white:   "#d3d3d3",
        brightBlack:   "#555753", brightRed:     "#ef2929",
        brightGreen:   "#8ae234", brightYellow:  "#fce94f",
        brightBlue:    "#729fcf", brightMagenta: "#ad7fa8",
        brightCyan:    "#34e2e2", brightWhite:   "#eeeeec",
      },
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);

    // ── Expose write function to parent first (registers termWriteFn +
    //    sends terminal:ready RPC). Shell spawn is deferred until the
    //    first onResize call below, which carries the real viewport size.
    onMounted((b64: string) => {
      if (!term) return;
      term.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    });

    // ── Forward user input to backend as base64 ───────────────────────
    const enc = new TextEncoder();
    term.onData((data: string) => {
      const bytes = enc.encode(data);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      onInput(btoa(bin));
    });

    // ── Fit after the browser has finished layout (RAF) ───────────────
    // Do NOT call fitAddon.fit() synchronously here — the container may
    // not have its final dimensions yet.  requestAnimationFrame waits
    // for the layout pass to complete, then measures and notifies the
    // backend of the real cols/rows.  That first onResize call is what
    // triggers spawnShell() in terminal.ts.
    let rafId = requestAnimationFrame(() => {
      fitAddon?.fit();
      if (term) onResize(term.cols, term.rows);
    });

    // ── Debounced ResizeObserver ───────────────────────────────────────
    // Handles all subsequent size changes, including fullscreen toggle
    // (parent applies fixed+inset-0 → container resizes → this fires).
    // Debounce prevents multiple SIGWINCH signals during a resize drag.
    let resizeTimer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fitAddon?.fit();
        if (term) onResize(term.cols, term.rows);
      }, 16);
    });
    ro.observe(containerEl);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      ro.disconnect();
      term?.dispose();
    };
  });

  // NOTE: $effect for fullscreen removed — ResizeObserver already handles
  // the container-size change triggered by the CSS class toggle.
</script>

<!-- Wrapper fills whatever space its parent gives it -->
<div bind:this={containerEl} class="terminal-host"></div>

<style>
  .terminal-host {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #1e1f22;
  }

  /* xterm.js internal layout fixes */
  :global(.terminal-host .xterm) {
    height: 100%;
    padding: 2px 6px;
  }
  :global(.terminal-host .xterm-viewport) {
    overflow-y: auto !important;
  }
  /* Eliminar cualquier line-height extra que inyecte el navegador */
  :global(.terminal-host .xterm-rows) {
    line-height: normal;
  }
</style>
