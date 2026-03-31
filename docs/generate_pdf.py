#!/usr/bin/env python3
"""Generate PDF from the ARM64 ioctl PTY bug documentation."""

from fpdf import FPDF
import os

class BugReportPDF(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "ultimate_editor - Bug Report", align="L")
        self.cell(0, 8, "2026-03-30", align="R", new_x="LMARGIN", new_y="NEXT")
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title):
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(30, 30, 30)
        self.ln(4)
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)

    def sub_title(self, title):
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(50, 50, 50)
        self.ln(2)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body_text(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def code_block(self, code):
        self.set_font("Courier", "", 8.5)
        self.set_fill_color(240, 240, 240)
        self.set_text_color(30, 30, 30)
        x = self.get_x()
        self.set_x(x + 2)
        for line in code.strip().split("\n"):
            self.cell(0, 4.5, "  " + line, new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)

    def table_row(self, cells, header=False):
        self.set_font("Helvetica", "B" if header else "", 9)
        if header:
            self.set_fill_color(50, 50, 50)
            self.set_text_color(255, 255, 255)
        else:
            self.set_fill_color(245, 245, 245)
            self.set_text_color(30, 30, 30)
        col_widths = [190 / len(cells)] * len(cells)
        for i, cell in enumerate(cells):
            self.cell(col_widths[i], 7, str(cell), border=1, fill=True)
        self.ln()

    def diagram_box(self, title, lines, x, y, w, color=(220, 235, 255)):
        self.set_fill_color(*color)
        self.set_draw_color(100, 100, 100)
        h = 7 + len(lines) * 5
        self.rect(x, y, w, h, "DF")
        self.set_xy(x + 2, y + 1)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(30, 30, 30)
        self.cell(w - 4, 5, title, align="C")
        self.set_font("Courier", "", 7)
        for i, line in enumerate(lines):
            self.set_xy(x + 3, y + 7 + i * 5)
            self.cell(w - 6, 5, line)

    def arrow_down(self, x, y1, y2, label=""):
        self.set_draw_color(80, 80, 80)
        self.line(x, y1, x, y2 - 2)
        # arrowhead
        self.line(x, y2 - 2, x - 2, y2 - 5)
        self.line(x, y2 - 2, x + 2, y2 - 5)
        if label:
            self.set_font("Helvetica", "I", 7)
            self.set_text_color(80, 80, 80)
            self.text(x + 3, (y1 + y2) / 2, label)


def generate():
    pdf = BugReportPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ── Page 1: Title + Summary ──────────────────────────────────────────────
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(20, 20, 20)
    pdf.ln(10)
    pdf.cell(0, 12, "ARM64 Variadic FFI Calling Convention", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 12, "Breaks PTY Terminal Size", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)

    # Severity badge
    pdf.set_fill_color(220, 50, 50)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    badge_w = pdf.get_string_width("  CRITICAL  ") + 6
    pdf.set_x((210 - badge_w) / 2)
    pdf.cell(badge_w, 8, "  CRITICAL  ", fill=True, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)

    pdf.set_text_color(30, 30, 30)
    pdf.body_text(
        "Programs that rely on ncurses initscr() (such as top, htop, cmatrix) fail with "
        '"Error opening terminal: xterm-256color" when run inside the app\'s embedded terminal. '
        "The root cause is an ARM64 (Apple Silicon) calling convention incompatibility when "
        "invoking the variadic C function ioctl() through Bun FFI."
    )

    # Symptoms table
    pdf.section_title("Symptoms")
    pdf.table_row(["Program", "Result in App Terminal", "Result in Regular Terminal"], header=True)
    pdf.table_row(["top", "Error opening terminal: xterm-256color", "Works"])
    pdf.table_row(["htop", "Error opening terminal: xterm-256color", "Works"])
    pdf.table_row(["cmatrix", "Error opening terminal: xterm-256color", "Works"])
    pdf.table_row(["vim", "Works (built-in termcap)", "Works"])
    pdf.table_row(["neovim", "Works (uses unibilium)", "Works"])
    pdf.table_row(["tput colors", "Returns 256 (correct)", "Works"])
    pdf.ln(3)

    pdf.body_text("Key diagnostic results from inside the app terminal:")
    pdf.code_block(
        "$ stty size\n"
        "45444 1786          # Garbage values! Should be ~24 80\n"
        "\n"
        "$ tput colors\n"
        "256                 # setupterm() works fine\n"
        "\n"
        "$ LINES=24 COLUMNS=80 top\n"
        "(works!)            # Confirms bad PTY dimensions are the cause"
    )

    # ── Page 2: Root Cause ───────────────────────────────────────────────────
    pdf.add_page()
    pdf.section_title("Root Cause: ARM64 Variadic Calling Convention")

    pdf.body_text(
        "On ARM64 (Apple Silicon), the calling convention for variadic functions differs "
        "from non-variadic functions. Regular arguments are passed in registers x0-x7, but "
        "variadic arguments are passed on the STACK."
    )
    pdf.body_text(
        'ioctl() has the signature: int ioctl(int fd, unsigned long request, ...) - '
        "the third argument is variadic. When called via Bun FFI, the pointer is placed "
        "in register x2 (as a regular argument). But ioctl reads it from the stack, "
        "getting a garbage pointer instead."
    )

    pdf.sub_title("x86_64 vs ARM64 Calling Convention")
    # x86_64 box
    y_start = pdf.get_y() + 2
    pdf.diagram_box(
        "x86_64 (Intel)",
        [
            "All args in registers (rdi, rsi, rdx...)",
            "Variadic = same convention as regular",
            "ioctl(fd, req, ptr) via FFI -> WORKS",
        ],
        15, y_start, 85, color=(210, 240, 210)
    )
    # ARM64 box
    pdf.diagram_box(
        "ARM64 (Apple Silicon)",
        [
            "Regular args: registers x0-x7",
            "Variadic args: STACK (different!)",
            "FFI puts ptr in x2 (register)",
            "ioctl reads ptr from stack -> GARBAGE",
        ],
        110, y_start, 85, color=(255, 220, 220)
    )
    pdf.set_y(y_start + 35)
    pdf.ln(5)

    pdf.sub_title("What Happens Step by Step")
    pdf.code_block(
        "1. Bun FFI calls: ioctl(fd, TIOCSWINSZ, ptr_to_winsize)\n"
        "   -> fd goes in x0 (correct)\n"
        "   -> TIOCSWINSZ goes in x1 (correct)\n"
        "   -> ptr_to_winsize goes in x2 (WRONG! should be on stack)\n"
        "\n"
        "2. ioctl() implementation reads 3rd arg from stack\n"
        "   -> gets garbage pointer (e.g. 0x6905FA4806FAB194)\n"
        "\n"
        "3. ioctl writes winsize struct to garbage address\n"
        "   -> for TIOCSWINSZ: reads garbage as winsize -> PTY gets 45444x1786\n"
        "   -> for TIOCGWINSZ: writes to garbage address -> SEGFAULT"
    )

    # ── Page 3: Why the error was misleading ─────────────────────────────────
    pdf.add_page()
    pdf.section_title("Why the Error Message Was Misleading")

    pdf.body_text(
        'The error "Error opening terminal: xterm-256color" implies a terminfo lookup '
        "failure. In reality, the terminfo was found correctly - the failure occurred "
        "during screen buffer allocation due to the garbage PTY dimensions."
    )

    pdf.sub_title("ncurses initscr() Flow Diagram")
    # Draw the flow diagram
    y = pdf.get_y() + 5
    box_w = 80
    box_x = (210 - box_w) / 2

    pdf.diagram_box("initscr()", ["Entry point"], box_x, y, box_w, (220, 235, 255))
    pdf.arrow_down(box_x + box_w / 2, y + 12, y + 22)

    y += 24
    pdf.diagram_box("setupterm()", ["Find terminfo for xterm-256color", "Result: SUCCESS"], box_x, y, box_w, (210, 240, 210))
    pdf.arrow_down(box_x + box_w / 2, y + 17, y + 27, "OK")

    y += 29
    pdf.diagram_box("_nc_setupscreen()", [
        "Get PTY size via TIOCGWINSZ:",
        "  rows = 45444, cols = 1786",
        "malloc(45444 * 1786) = ~80MB",
        "  -> ALLOCATION FAILS"
    ], box_x, y, box_w, (255, 220, 220))
    pdf.arrow_down(box_x + box_w / 2, y + 27, y + 37, "NULL")

    y += 39
    pdf.diagram_box("initscr() error handler", [
        '"Error opening terminal: xterm-256color"',
        "exit(1)"
    ], box_x, y, box_w, (255, 200, 200))

    pdf.set_y(y + 22)
    pdf.ln(5)

    pdf.body_text(
        "tput works because it only calls setupterm() (step 2) and never reaches "
        "_nc_setupscreen() (step 3). vim/neovim work because they use their own "
        "built-in terminal definitions and bypass ncurses initscr() entirely."
    )

    # ── Page 4: The Fix ──────────────────────────────────────────────────────
    pdf.add_page()
    pdf.section_title("The Fix: Non-Variadic C Wrapper")

    pdf.body_text(
        "Created a thin C wrapper library (pty_helpers.dylib) with a fixed, "
        "non-variadic function signature. Since all arguments are regular parameters, "
        "Bun FFI passes them correctly in registers on ARM64."
    )

    pdf.sub_title("src/native/pty_helpers.c")
    pdf.code_block(
        "#include <sys/ioctl.h>\n"
        "\n"
        "int pty_set_winsize(int fd, unsigned short rows,\n"
        "                    unsigned short cols) {\n"
        "    struct winsize ws = {0};\n"
        "    ws.ws_row = rows;\n"
        "    ws.ws_col = cols;\n"
        "    return ioctl(fd, TIOCSWINSZ, &ws);\n"
        "}"
    )

    pdf.sub_title("Before (broken FFI call)")
    pdf.code_block(
        "// ioctl is variadic -> 3rd arg corrupted on ARM64\n"
        "const ws = new Uint16Array([rows, cols, 0, 0]);\n"
        "ioctl(fd, TIOCSWINSZ, ptr(ws));  // BROKEN"
    )

    pdf.sub_title("After (fixed FFI call)")
    pdf.code_block(
        "// Non-variadic wrapper -> all args in registers\n"
        "pty_set_winsize(fd, rows, cols);  // CORRECT"
    )

    pdf.section_title("Files Changed")
    pdf.table_row(["File", "Change"], header=True)
    pdf.table_row(["src/native/pty_helpers.c", "New: non-variadic ioctl wrapper"])
    pdf.table_row(["src/native/pty_helpers.dylib", "New: compiled native library"])
    pdf.table_row(["src/bun/terminal.ts", "Use pty_helpers instead of direct ioctl"])
    pdf.table_row(["electrobun.config.ts", "Added dylib to build copy targets"])

    # ── Page 5: Lessons Learned ──────────────────────────────────────────────
    pdf.add_page()
    pdf.section_title("Lessons Learned")

    pdf.sub_title("1. ARM64 Variadic FFI is a Known Pitfall")
    pdf.body_text(
        "Any variadic C function (ioctl, fcntl, open with O_CREAT, printf, etc.) "
        "called via FFI on ARM64 will silently corrupt arguments past the last "
        "non-variadic parameter. This applies to Bun FFI, Node.js FFI (ffi-napi), "
        "and any FFI system that doesn't handle variadic calling conventions."
    )

    pdf.sub_title("2. Error Messages Can Be Deeply Misleading")
    pdf.body_text(
        '"Error opening terminal: xterm-256color" sent us investigating terminfo '
        "paths, ncurses versions, and file formats. The actual problem was garbage "
        "PTY dimensions causing screen buffer allocation failure. The error message "
        "refers to the terminal TYPE, not the problem."
    )

    pdf.sub_title("3. Programs That Work Aren't Proof the System is Correct")
    pdf.body_text(
        "vim and neovim working masked the PTY size bug because they bypass ncurses "
        "initscr(). Their success created a false sense that the terminal setup was correct."
    )

    pdf.sub_title("4. Check Simple Things First")
    pdf.body_text(
        "Running 'stty size' early would have immediately revealed the garbage "
        "dimensions (45444 x 1786). The terminfo investigation was a red herring "
        "that consumed significant debugging time."
    )

    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 10, "Compiled: cc -shared -o pty_helpers.dylib src/native/pty_helpers.c", align="C")

    # Output
    outpath = os.path.join(os.path.dirname(__file__), "arm64-ioctl-pty-bug.pdf")
    pdf.output(outpath)
    print(f"PDF generated: {outpath}")


if __name__ == "__main__":
    generate()
