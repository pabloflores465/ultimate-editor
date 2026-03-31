# Bug Report: ARM64 Variadic FFI Calling Convention Breaks PTY Terminal Size

**Project:** ultimate_editor  
**Date:** 2026-03-30  
**Severity:** Critical — all ncurses-based programs (top, htop, cmatrix) fail inside the app terminal  
**Status:** Fixed  

---

## Summary

Programs that rely on ncurses `initscr()` (such as `top`, `htop`, `cmatrix`) crash with **"Error opening terminal: xterm-256color"** when run inside the app's embedded terminal. The root cause is an ARM64 (Apple Silicon) calling convention incompatibility when invoking the variadic C function `ioctl()` through Bun FFI.

---

## Symptoms

| Program     | Result in app terminal           | Result in regular terminal |
|-------------|----------------------------------|----------------------------|
| `top`       | `Error opening terminal: xterm-256color.` | Works normally |
| `htop`      | `Error opening terminal: xterm-256color.` | Works normally |
| `cmatrix`   | `Error opening terminal: xterm-256color.` | Works normally |
| `vim`       | Works (has built-in termcap)     | Works normally |
| `neovim`    | Works (uses unibilium)           | Works normally |
| `tput colors` | Returns `256` (correct)        | Works normally |

Key observations:
- `stty size` inside the app returned **`45444 1786`** — absurdly large garbage values
- `tput colors` worked correctly (uses `setupterm()` only, not `initscr()`)
- `LINES=24 COLUMNS=80 top` **worked** — confirming the terminal size was the problem

---

## Investigation Timeline

### 1. Initial Hypothesis: Terminfo Resolution (Ruled Out)

We first suspected ncurses couldn't find the `xterm-256color` terminfo entry:

- `~/.terminfo/78/xterm-256color` existed but was in **ncurses 6.x extended format** (magic `1e 02`)
- `/usr/share/terminfo/78/xterm-256color` existed in **ncurses 5.x legacy format** (magic `1a 01`)
- System `top` links against ncurses 5.4 (`/usr/lib/libncurses.5.4.dylib`)

We set `TERMINFO=/usr/share/terminfo` and `TERMINFO_DIRS=/usr/share/terminfo` in the shell environment. **This did not fix the issue.**

Verified with `infocmp -D` inside the app — terminfo paths were correct and resolvable.

### 2. Second Hypothesis: initscr() vs setupterm() (Key Clue)

Discovered that `tput colors` (which uses `setupterm()`) worked, but `top` (which uses `initscr()`) failed. `initscr()` calls `newterm()` which allocates a screen buffer based on the terminal size. If the size is absurdly large, the allocation fails.

**`stty size` confirmed:** `45444 1786` — the PTY had garbage dimensions.

### 3. Third Hypothesis: Bad Values from FitAddon (Ruled Out)

Backend logs showed xterm.js FitAddon was sending **`43x7`** — perfectly reasonable values. The `resizePty()` function received them correctly. But `stty size` showed completely different numbers.

### 4. Root Cause: ARM64 Variadic Calling Convention

Added a `TIOCGWINSZ` readback call to verify the ioctl result:

```
panic: Segmentation fault at address 0x6905FA4806FAB194
```

The crash address **contains the garbage stty values**: `06FA` = 1786, `B1A4` ≈ 45444.

---

## Root Cause Analysis

### The Problem: Variadic Functions on ARM64

```
┌─────────────────────────────────────────────────────────────┐
│                    x86_64 (Intel)                           │
│                                                             │
│  All arguments passed in registers (rdi, rsi, rdx, ...)    │
│  Variadic and non-variadic use the SAME convention         │
│  → ioctl(fd, TIOCSWINSZ, ptr) works via FFI                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                ARM64 (Apple Silicon)                        │
│                                                             │
│  Regular args:   registers x0-x7                           │
│  Variadic args:  STACK (different from regular args!)       │
│                                                             │
│  ioctl() signature: int ioctl(int fd, unsigned long req, ...)
│                                       ──────────────────    │
│                                       variadic starts here  │
│                                                             │
│  Bun FFI passes 3rd arg in register x2 (as regular arg)    │
│  ioctl reads 3rd arg from STACK → gets garbage pointer     │
│  → writes winsize to garbage address                       │
│  → PTY gets garbage dimensions (45444 × 1786)              │
└─────────────────────────────────────────────────────────────┘
```

### Why It Appeared as a Terminfo Error

```
                    ncurses initscr() flow
                    ═══════════════════════

                    ┌──────────────┐
                    │  initscr()   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  newterm()   │
                    └──────┬───────┘
                           │
                ┌──────────▼──────────┐
                │    setupterm()      │ ← tput uses ONLY this → works
                │  (find terminfo)    │
                └──────────┬──────────┘
                           │ OK
                ┌──────────▼──────────┐
                │  _nc_setupscreen()  │ ← allocates screen buffer
                │                     │    using PTY dimensions
                │  rows = 45444       │
                │  cols = 1786        │
                │                     │
                │  malloc(45444×1786)  │ ← ~80MB allocation
                │       FAILS         │
                └──────────┬──────────┘
                           │ NULL
                ┌──────────▼──────────┐
                │  newterm() → NULL   │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────────────────────┐
                │  "Error opening terminal: xterm-256color" │
                └─────────────────────────────────────┘

        Misleading error message! The terminal TYPE was found,
        but screen allocation failed due to garbage dimensions.
```

### Why vim/neovim Were Not Affected

```
┌───────────┬────────────────────────────────┐
│ Program   │ Why it works                   │
├───────────┼────────────────────────────────┤
│ vim       │ Built-in termcap database;     │
│           │ doesn't use ncurses initscr()  │
├───────────┼────────────────────────────────┤
│ neovim    │ Uses unibilium library with    │
│           │ built-in terminal definitions  │
├───────────┼────────────────────────────────┤
│ tput      │ Only calls setupterm(), never  │
│           │ allocates a screen buffer      │
└───────────┴────────────────────────────────┘
```

---

## Fix

### Solution: Non-variadic C Wrapper

Created `src/native/pty_helpers.c` — a thin wrapper with a **fixed (non-variadic) signature** so Bun FFI passes all arguments in registers correctly:

```c
#include <sys/ioctl.h>

int pty_set_winsize(int fd, unsigned short rows, unsigned short cols) {
    struct winsize ws = {0};
    ws.ws_row = rows;
    ws.ws_col = cols;
    return ioctl(fd, TIOCSWINSZ, &ws);
}
```

Compiled to a native dylib:

```bash
cc -shared -o src/native/pty_helpers.dylib src/native/pty_helpers.c
```

### FFI Usage (terminal.ts)

**Before (broken):**
```typescript
const { symbols: { ioctl } } = dlopen("libSystem.B.dylib", {
  ioctl: {
    args: [FFIType.int32_t, FFIType.uint64_t, FFIType.ptr],
    returns: FFIType.int32_t,
  },
});

function setWinSize(fd: number, cols: number, rows: number): void {
  const ws = new Uint16Array([rows, cols, 0, 0]);
  ioctl(fd, TIOCSWINSZ, ptr(ws));  // 3rd arg goes in register → WRONG on ARM64
}
```

**After (fixed):**
```typescript
const { symbols: { pty_set_winsize } } = dlopen(ptyHelpersPath, {
  pty_set_winsize: {
    args: [FFIType.int32_t, FFIType.u16, FFIType.u16],
    returns: FFIType.int32_t,
  },
});

function setWinSize(fd: number, cols: number, rows: number): void {
  pty_set_winsize(fd, rows, cols);  // All regular args → correct on ARM64
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/native/pty_helpers.c` | New — non-variadic ioctl wrapper |
| `src/native/pty_helpers.dylib` | New — compiled native library |
| `src/bun/terminal.ts` | Replaced direct ioctl FFI with pty_helpers wrapper |
| `electrobun.config.ts` | Added dylib to build copy targets |

---

## Lessons Learned

1. **ARM64 variadic calling convention differs from x86_64** — this is a well-known ABI difference but easy to overlook when using FFI. Any variadic C function (`ioctl`, `fcntl`, `open` with O_CREAT, `printf`, etc.) called via FFI on ARM64 will silently corrupt arguments.

2. **Error messages can be deeply misleading** — "Error opening terminal: xterm-256color" sent us investigating terminfo paths, ncurses versions, and file formats, when the actual problem was garbage PTY dimensions causing screen buffer allocation failure.

3. **Programs that "just work" aren't proof the system is correct** — vim/neovim working masked the PTY size bug because they bypass ncurses `initscr()`.

4. **Diagnostic order matters** — checking `stty size` early would have immediately revealed the garbage dimensions. The terminfo investigation, while educational, was a red herring.
