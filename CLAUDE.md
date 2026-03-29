# ultimate_editor — Guía de arquitectura para Claude

## Visión general

Editor de código de escritorio construido con **Bun + Electrobun** (proceso principal) y **Svelte 5 + Vite** (UI en WebView). Inspirado en JetBrains IntelliJ IDEA con soporte de múltiples escritorios (workspaces) totalmente aislados.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime de escritorio | [Electrobun](https://electrobun.dev) 1.16.0 (wrapper ligero sobre Bun) |
| Proceso principal | Bun (TypeScript nativo) |
| UI / Renderer | Svelte 5 con runes (`$state`, `$derived`, `$effect`) |
| Bundler UI | Vite 6 con HMR |
| Estilos | Tailwind CSS 4.2 |
| Editor de código | CodeMirror 6 |
| Terminal | xterm.js + PTY nativo vía Bun FFI |
| Comunicación IPC | Electrobun RPC (tipado con `AppSchema`) |

---

## Estructura de carpetas

```
src/
├── bun/                        # Proceso principal (Bun/Node runtime)
│   ├── index.ts                # Ventana, RPC, menús, enrutamiento de terminales
│   ├── terminal.ts             # Motor PTY multi-sesión (zsh via libSystem FFI)
│   └── webgpu-renderer.ts      # Renderizado WebGPU (triángulo de demo)
│
└── mainview/                   # Proceso renderer (Svelte 5)
    ├── main.ts                 # Punto de entrada Svelte
    ├── index.html
    ├── app.css
    ├── App.svelte              # Router raíz (svelte-spa-router)
    │
    ├── stores/
    │   └── workspaceStore.svelte.ts   # Estado global de todos los escritorios
    │
    └── components/
        ├── WorkspaceSwitcher.svelte   # Motor de gestos y transiciones
        ├── EditorLayout.svelte        # Layout JetBrains + RPC terminal por escritorio
        ├── Sidebar.svelte             # Barra lateral izquierda
        ├── FileTree.svelte            # Árbol de archivos recursivo
        ├── CodeEditor.svelte          # Integración CodeMirror 6
        ├── Terminal.svelte            # Integración xterm.js
        ├── WorkspaceOverview.svelte   # Modal de cuadrícula de escritorios
        ├── WorkspacePreviewFull.svelte
        └── WorkspaceCard.svelte
```

---

## Arquitectura multi-escritorio (desktops aislados)

### Principio fundamental

**Cada escritorio es una instancia completamente independiente** del editor con su propio:
- Terminal PTY (proceso zsh separado)
- Directorio raíz del proyecto (`rootPath`)
- Pestañas de editor abiertas y estado activo
- Configuración de paneles (ancho, alto, herramienta activa)
- Breakpoints por archivo
- Historial de rutas (para restaurar al cambiar)

### `WorkspaceState` (workspaceStore.svelte.ts)

Cada escritorio es un objeto `WorkspaceState` con estos campos clave:

```typescript
interface WorkspaceState {
  id: string;              // UUID único — usado como clave de PTY y routing RPC
  name: string;            // Nombre visible
  rootPath: string;        // Directorio raíz del proyecto (vacío = sin proyecto)
  openTabs: EditorTab[];   // Pestañas abiertas en este escritorio
  activeTabId: string | null;
  breakpoints: Record<string, number[]>;
  // ...estado de paneles, expansión de carpetas, etc.
}
```

El `WorkspaceStore` expone:
- `workspaces` — array reactivo de todos los escritorios
- `activeIndex` — índice del escritorio activo
- `addWorkspace()` — crea un nuevo escritorio vacío
- `removeWorkspace(id)` — elimina un escritorio (mínimo 1)
- `switchTo(index)` — cambia de escritorio con animación
- `setRootPath(id, path)` — asigna el proyecto de un escritorio

### Motor PTY multi-sesión (terminal.ts)

El backend mantiene un `Map<workspaceId, PtySession>` donde cada sesión tiene:

```typescript
interface PtySession {
  masterFd: number;      // File descriptor PTY master
  slaveFd: number;       // File descriptor PTY slave
  shellSpawned: boolean; // ¿Ya se lanzó el shell?
  sendFn: Function;      // Callback para enviar output al webview
}
```

**API pública:**

| Función | Descripción |
|---------|-------------|
| `createTerminalForWorkspace(id, send)` | Crea un PTY para el escritorio. El shell se lanza en diferido. |
| `writeToTty(id, b64)` | Envía input del usuario (base64) al PTY del escritorio. |
| `resizePty(id, cols, rows)` | Redimensiona el PTY. **En la primera llamada, también lanza el shell** con el tamaño correcto. |
| `destroyTerminal(id)` | Cierra el PTY master/slave y elimina la sesión. |

Cada sesión tiene su propio ZDOTDIR temporal (`/tmp/ult-zsh-<workspaceId>/`) con wrappers de `.zshenv` y `.zshrc` que preservan la configuración del usuario y desactivan comportamientos problemáticos (p10k instant prompt, PROMPT_SP).

### RPC tipado (index.ts ↔ EditorLayout.svelte)

Todos los mensajes de terminal incluyen `workspaceId` para enrutamiento correcto:

```typescript
// Webview → Bun
"terminal:input":  { data: string; workspaceId: string }
"terminal:resize": { cols: number; rows: number; workspaceId: string }
"terminal:ready":  { workspaceId: string }

// Bun → Webview
"terminal:output": { data: string; workspaceId: string }
```

**Flujo de creación de terminal por escritorio:**

1. `EditorLayout` monta el componente `Terminal` con `ws.id` del escritorio activo
2. `Terminal.svelte` llama `onResize` → `sendTermResize({ cols, rows, workspaceId: ws.id })`
3. `index.ts` recibe `terminal:resize` → llama `resizePty(workspaceId, cols, rows)`
4. `Terminal.svelte` expone `writeFn` → `onMounted` llama `sendTermReady({ workspaceId: ws.id })`
5. `index.ts` recibe `terminal:ready` → crea sesión PTY si no existe, vacía el buffer pendiente
6. `terminal:output` llega al webview con `workspaceId`; `EditorLayout` solo procesa si `workspaceId === ws.id`

**Buffering por escritorio:** el output PTY se bufferiza en `workspaceBuffers: Map<string, string[]>` hasta que el webview del escritorio envíe `terminal:ready`.

---

## Navegación entre escritorios

### WorkspaceSwitcher.svelte

Envuelve todo el contenido y captura eventos para cambiar de escritorio:

| Método | Atajo / Gesto |
|--------|--------------|
| Siguiente escritorio | `Ctrl+Alt+→` |
| Escritorio anterior | `Ctrl+Alt+←` |
| Nuevo escritorio | `Ctrl+Alt+N` |
| Vista general | `Ctrl+Shift+\`` |
| Swipe trackpad | 2 dedos horizontal (umbral: 28% viewport o 350 px/s) |

Usa un layout de 3 slots (anterior / actual / siguiente) con animaciones spring físicamente basadas (critically damped al hacer snap, underdamped al cancelar).

---

## Comandos de desarrollo

```bash
bun run start       # Compilar UI + iniciar app en modo dev
bun run dev:hmr     # Vite HMR + Electrobun en paralelo (desarrollo activo)
bun run build:canary  # Build de distribución canary
```

---

## Patrones y convenciones

- **Svelte 5 runes**: usar `$state`, `$derived`, `$effect`. No usar stores de Svelte 4 (`writable`, `readable`).
- **RPC siempre tipado**: el `AppSchema` en `index.ts` y `EditorLayout.svelte` deben estar sincronizados.
- **workspaceId como clave universal**: cualquier recurso per-workspace (PTY, buffer, estado) se indexa por `ws.id` (UUID estable durante la sesión).
- **Terminal deferred spawn**: el shell zsh no se lanza hasta recibir `terminal:resize` para evitar output mal formateado a 80×24.
- **No node-pty**: los módulos nativos `.node` no funcionan en el bundle de Electrobun. Se usa Bun FFI + `libSystem.B.dylib` directamente.
