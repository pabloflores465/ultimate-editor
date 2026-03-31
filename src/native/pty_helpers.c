/**
 * pty_helpers.c — Non-variadic wrappers around ioctl for PTY operations.
 *
 * ioctl() is variadic on POSIX, which means on ARM64 (Apple Silicon) the
 * third argument is passed on the stack rather than in a register. Bun FFI
 * doesn't distinguish variadic from non-variadic calls, so calling ioctl
 * directly via FFI silently corrupts the winsize — the kernel reads garbage
 * from the stack instead of our struct pointer.
 *
 * These thin wrappers have fixed signatures so Bun FFI passes arguments
 * correctly in registers.
 *
 * Build:
 *   cc -shared -o pty_helpers.dylib src/native/pty_helpers.c
 */

#include <sys/ioctl.h>

int pty_set_winsize(int fd, unsigned short rows, unsigned short cols) {
    struct winsize ws = {0};
    ws.ws_row = rows;
    ws.ws_col = cols;
    return ioctl(fd, TIOCSWINSZ, &ws);
}

int pty_get_winsize(int fd, unsigned short *rows, unsigned short *cols) {
    struct winsize ws = {0};
    int ret = ioctl(fd, TIOCGWINSZ, &ws);
    if (ret == 0) {
        *rows = ws.ws_row;
        *cols = ws.ws_col;
    }
    return ret;
}
