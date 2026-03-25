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
    fitAddon.fit();

    // Notify backend of initial size
    onResize(term.cols, term.rows);

    // Forward user keystrokes/paste to backend as base64.
    // Usamos TextEncoder → reduce a bytes UTF-8 → btoa via String.fromCharCode.
    // fromCharCode con spread solo es seguro para arrays pequeños (input de usuario
    // siempre es corto), así que es la opción más rápida aquí.
    const enc = new TextEncoder();
    term.onData((data: string) => {
      const bytes = enc.encode(data);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      onInput(btoa(bin));
    });

    // Auto-resize when container changes size
    const ro = new ResizeObserver(() => {
      fitAddon?.fit();
      if (term) onResize(term.cols, term.rows);
    });
    ro.observe(containerEl);

    // Expose write function to parent.
    // Decode base64 → Uint8Array con Uint8Array.from que es nativo (más rápido
    // que el bucle manual byte-a-byte con índices).
    onMounted((b64: string) => {
      if (!term) return;
      term.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    });

    return () => {
      ro.disconnect();
      term?.dispose();
    };
  });

  // Re-fit when fullscreen changes
  $effect(() => {
    // Depend on fullscreen reactively
    const _ = fullscreen;
    setTimeout(() => {
      fitAddon?.fit();
      if (term) onResize(term.cols, term.rows);
    }, 50);
  });
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
    padding: 6px 8px;
  }
  :global(.terminal-host .xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
