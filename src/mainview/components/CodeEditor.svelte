<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState, Compartment } from "@codemirror/state";
  import { javascript } from "@codemirror/lang-javascript";
  import { html } from "@codemirror/lang-html";
  import { css } from "@codemirror/lang-css";
  import { json } from "@codemirror/lang-json";
  import { keymap } from "@codemirror/view";

  // ── Props ────────────────────────────────────────────────────────
  let {
    tabId,
    content,
    icon,
    onContentChange,
    onSave,
  }: {
    tabId: string;
    content: string;
    icon: string;
    onContentChange: (content: string) => void;
    onSave: () => void;
  } = $props();

  // ── Internals ────────────────────────────────────────────────────
  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let isRestoring = false;

  const langComp = new Compartment();

  function getLang(iconStr: string) {
    switch (iconStr) {
      case "ts":     return javascript({ typescript: true, jsx: false });
      case "tsx":    return javascript({ typescript: true, jsx: true });
      case "js":     return javascript({ typescript: false, jsx: false });
      case "jsx":    return javascript({ typescript: false, jsx: true });
      case "svelte":
      case "html":   return html();
      case "css":
      case "scss":   return css();
      case "json":   return json();
      default:       return [];
    }
  }

  // JetBrains Darcula-inspired theme
  const darkTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: "#2b2b2b",
        color: "#a9b7c6",
        height: "100%",
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: "13px",
      },
      ".cm-content": {
        caretColor: "#aeafad",
        padding: "4px 0",
        lineHeight: "1.6",
      },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-cursor": { borderLeftColor: "#aeafad" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "#214283 !important",
      },
      ".cm-gutters": {
        backgroundColor: "#2b2b2b",
        color: "#606366",
        border: "none",
        borderRight: "1px solid #3c3f41",
        userSelect: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        color: "#606366",
        minWidth: "40px",
        paddingRight: "8px",
        textAlign: "right",
      },
      ".cm-foldGutter .cm-gutterElement": { color: "#606366" },
      ".cm-activeLine": { backgroundColor: "#323232" },
      ".cm-activeLineGutter": { backgroundColor: "#2f3031", color: "#aab0b6" },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "rgba(100,100,100,0.3)",
        outline: "1px solid #606366",
      },
      ".cm-tooltip": {
        backgroundColor: "#3c3f41",
        border: "1px solid #4c5052",
        color: "#a9b7c6",
      },
      ".cm-tooltip-autocomplete > ul > li": { padding: "2px 6px" },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "#214283",
        color: "#ffffff",
      },
      ".cm-panels": { backgroundColor: "#3c3f41", color: "#a9b7c6" },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid #4c5052" },
      ".cm-panels.cm-panels-bottom": { borderTop: "1px solid #4c5052" },
      ".cm-search": { padding: "4px 8px", backgroundColor: "#3c3f41" },
      ".cm-textfield": {
        backgroundColor: "#45484a",
        border: "1px solid #5a5d5f",
        color: "#a9b7c6",
        borderRadius: "2px",
        padding: "2px 4px",
      },
      ".cm-button": {
        backgroundColor: "#4c5052",
        border: "1px solid #5a5d5f",
        color: "#a9b7c6",
        borderRadius: "2px",
        padding: "2px 8px",
        cursor: "pointer",
      },
      ".cm-button:hover": { backgroundColor: "#5a5d5f" },
      ".cm-searchMatch": {
        backgroundColor: "#32593d",
        outline: "1px solid #629755",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "#1d3d5f",
        outline: "1px solid #4e9ede",
      },
      // Syntax highlighting
      ".tok-comment":   { color: "#808080", fontStyle: "italic" },
      ".tok-keyword":   { color: "#cc7832" },
      ".tok-string":    { color: "#6a8759" },
      ".tok-number":    { color: "#6897bb" },
      ".tok-bool":      { color: "#cc7832" },
      ".tok-null":      { color: "#cc7832" },
      ".tok-typeName":  { color: "#ffc66d" },
      ".tok-className": { color: "#ffc66d" },
      ".tok-propertyName": { color: "#9876aa" },
      ".tok-attributeName": { color: "#bababa" },
      ".tok-attributeValue": { color: "#6a8759" },
      ".tok-operator":  { color: "#a9b7c6" },
      ".tok-punctuation": { color: "#a9b7c6" },
      ".tok-variableName": { color: "#a9b7c6" },
      ".tok-function.tok-variableName": { color: "#ffc66d" },
      ".tok-tagName":   { color: "#e8bf6a" },
      ".tok-angleBracket": { color: "#808080" },
      ".tok-self":      { color: "#94558d" },
      ".tok-regexp":    { color: "#629755" },
      ".cm-line":       { paddingLeft: "4px" },
    },
    { dark: true }
  );

  // Save keymap (Ctrl/Cmd+S inside the editor)
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      run() {
        onSave();
        return true;
      },
    },
  ]);

  onMount(() => {
    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        darkTheme,
        saveKeymap,
        langComp.of(getLang(icon)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isRestoring) {
            onContentChange(update.state.doc.toString());
          }
        }),
      ],
    });

    view = new EditorView({ state, parent: container });
    // Focus the editor
    view.focus();

    return () => {
      view?.destroy();
      view = null;
    };
  });

  // When tabId, content or icon changes → sync editor
  $effect(() => {
    if (!view) return;

    // Sync content (e.g. switching tabs)
    const editorContent = view.state.doc.toString();
    if (editorContent !== content) {
      isRestoring = true;
      view.dispatch({
        changes: { from: 0, to: editorContent.length, insert: content },
        // Scroll to top when switching to a different file
        scrollIntoView: false,
      });
      // Scroll to start
      view.dispatch({
        effects: EditorView.scrollIntoView(0),
      });
      isRestoring = false;
    }

    // Sync language
    view.dispatch({
      effects: langComp.reconfigure(getLang(icon)),
    });
  });

  // Expose focus method
  export function focus() {
    view?.focus();
  }
</script>

<div
  bind:this={container}
  class="h-full w-full overflow-hidden"
  style="background:#2b2b2b"
></div>
