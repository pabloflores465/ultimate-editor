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
  let lastCols = 0;
  let lastRows = 0;
  let mounted = false;

  onMount(() => {
    if (!containerEl) return;
    mounted = true;

    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1,
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

    // Fit síncrono: en Svelte 5 el DOM está completamente resuelto cuando
    // onMount corre, así que getBoundingClientRect() ya devuelve las
    // dimensiones finales del contenedor flex.
    fitAddon.fit();

    // DEBUG: ver dimensiones reales
    const rect = containerEl.getBoundingClientRect();
    console.log(`[Terminal] container: ${rect.width}x${rect.height}px`);
    console.log(`[Terminal] grid: ${term.cols}cols x ${term.rows}rows`);
    console.log(`[Terminal] cellHeight: ${(rect.height / term.rows).toFixed(1)}px`);

    // Primera llamada a onResize → terminal:resize RPC → spawnShell() con
    // el tamaño correcto. El output del shell se bufferiza hasta que
    // terminal:ready llegue (enviado por onMounted abajo).
    lastCols = term.cols;
    lastRows = term.rows;
    onResize(term.cols, term.rows);

    // Forward user input to backend as base64
    const enc = new TextEncoder();
    term.onData((data: string) => {
      if (!mounted) return;
      const bytes = enc.encode(data);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      onInput(btoa(bin));
    });

    // Debounced ResizeObserver — handles all subsequent size changes
    // (panel drag, fullscreen toggle via CSS class swap, window resize).
    // 16ms debounce coalesces bursts into a single SIGWINCH.
    // NOTE: ResizeObserver fires once synchronously for the initial
    // observation, but that triggers the 16ms debounce, so no extra
    // SIGWINCH is sent at startup (the sync fit above already ran).
    let resizeTimer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      if (!mounted) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!mounted || !fitAddon || !term) return;
        fitAddon.fit();
        if (term.cols !== lastCols || term.rows !== lastRows) {
          lastCols = term.cols;
          lastRows = term.rows;
          onResize(term.cols, term.rows);
        }
      }, 16);
    });
    ro.observe(containerEl);

    // Expose write function to parent AFTER fit+resize so that the backend
    // already has the correct PTY dimensions before we signal readiness.
    // EditorLayout's onMounted handler stores writeFn and calls sendTermReady().
    onMounted((b64: string) => {
      if (!mounted || !term) return;
      term.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    });

    return () => {
      mounted = false;
      clearTimeout(resizeTimer);
      ro.disconnect();
      term?.dispose();
      term = undefined;
      fitAddon = undefined;
    };
  });

  // $effect for fullscreen removed: ResizeObserver fires when the parent
  // toggles the fixed+inset-0 CSS classes, which changes containerEl's
  // dimensions and naturally triggers the debounced resize handler.
</script>

<!-- Wrapper fills whatever space its parent gives it -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={containerEl} class="terminal-host" onclick={() => term?.focus()}></div>

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
    padding: 0;
  }
  :global(.terminal-host .xterm-helper-textarea) {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    z-index: -1;
  }
  :global(.terminal-host .xterm-viewport) {
    overflow-y: scroll !important;
    overflow-x: scroll !important;
    background-color: #1e1f22 !important;
    min-width: 100%;
  }
  :global(.terminal-host .xterm-viewport::-webkit-scrollbar) {
    width: 10px;
    height: 10px;
  }
  :global(.terminal-host .xterm-viewport::-webkit-scrollbar-track) {
    background: #2b2d30;
  }
  :global(.terminal-host .xterm-viewport::-webkit-scrollbar-thumb) {
    background: #4c5052;
    border-radius: 5px;
    border: 2px solid #2b2d30;
  }
  :global(.terminal-host .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: #5c6062;
  }
  :global(.terminal-host .xterm-viewport::-webkit-scrollbar-corner) {
    background: #2b2d30;
  }
  /* Forzar line-height compacto — sin espacio extra entre líneas */
  :global(.terminal-host .xterm-rows) {
    line-height: 1 !important;
    min-width: max-content !important;
  }
</style>
