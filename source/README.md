# Source

The Rust calculator and loopback HTTP server embed all files under `ui/app/`
at compile time. Those plain HTML/CSS/JavaScript files are the editable UI
source for this edition; there is no frontend package manager or build step.

- `src/main.rs`: Wiki-compatible probability engine and CLI.
- `src/search.rs`: exhaustive enumeration, exact bounds, parallel search.
- `src/server.rs`: local HTTP API, embedded assets, browser launch/lifecycle.
- `data/`: Wiki data, provenance, independent forward-calculation fixtures.
- `ui/app/`: neutral text-only interface, vendored controls, embedded notices.
- `upstream/`: original Wiki worker retained as an independent test oracle.
- `tests/`: standalone EXE smoke test and optional JavaScript oracle check.
- `benchmarks/`: request and recorded measurements from the development PC.

From the repository root on Windows:

```powershell
.\source\build.ps1 -Test
.\source\tests\standalone.ps1
```

Requires a Rust toolchain and its platform linker for development only.
Use `build.ps1` for distributable builds: it remaps machine-specific paths,
strips symbols, builds in a temporary directory outside the repository, and
checks the binary before copying it to the repository root. A direct Cargo
build does not apply the script's privacy protections. Close a running copy
before replacing it. Run `source/tests/privacy.ps1` to scan all Git-uploadable
files plus the EXE for personal paths, machine names and common credential
patterns. This is a safety check, not a guarantee against every possible secret.

Edit `ui/app/` directly; Cargo automatically embeds changes on the next build.
The former Wiki branding, navigation and game-art stylesheet are preserved
outside this source tree in `../archive/wiki-ui/`. They are not compiled into
new builds. Generic OOUI controls remain; Wiki data, logic and attribution are
preserved. The sanitized root EXE is rebuilt from this neutral source UI.
No Node/npm is needed to build or run this edition. Node is optional solely
for cross-checking the original JavaScript oracle:

```powershell
.\"Perk Finder.exe" request source/benchmarks/impatient-mobile.json > result.json
node source/tests/rust-oracle.mjs result.json --full
```

Keep `Cargo.lock` committed. Do not commit `target/`, temporary test copies,
or new result dumps. GitHub Actions builds/tests the Windows binary and checks
it in a separate directory with an empty PATH, then uploads the EXE artifact.
The CI workflow has been added but has not yet run on GitHub.

## Accuracy and performance boundaries

The benchmark is Impatient 4 + Mobile, Ancient Armour, all eligible materials,
one through nine filled slots, up to nine distinct materials, effective levels
1–137. Exact bounds reject impossible material multisets; they are not sampled.
Recorded search time is 20–26 ms, not total browser rendering/startup time.

All 5,050 matching recipes' returned probabilities were checked at selected
best levels against the Wiki worker (maximum absolute difference 2.22e-16).
Additional fixtures cover rank distributions, double-slot behavior, and the
Wiki's 20-perk cap. These checks do not prove every possible search.
Direct stable consumption calculation can differ from the Wiki's subtraction
rounding for extremely rare non-empty outcomes. Broad low-rank searches can
be slower; a two-million-survivor guard reports an error, never partial success.

The reference benchmark uses ppartous/Runescape-perk-solver commit
8875f48dfc561d9693befb0803400a1eb5f02409. Its default six-material scope took
about 7 ms warm, versus our 2.14 ms. Its expanded all-material run exceeded
15 seconds. It samples every other level and returns best results per level;
our full search checks every level and returns all matching recipes. The
reference solver is not included in the executable.

## Attribution

Wiki-derived code/data/UI are attributed in
`ui/app/THIRD-PARTY-NOTICES.txt`, alongside dependency licence texts. This
file is embedded in the executable and linked from the app footer. Wiki
material is under CC BY-NC-SA 3.0; this is not an unrestricted commercial
licence. RuneScape belongs to Jagex. This project is unaffiliated with Jagex
and the RuneScape Wiki. Original URLs and revisions are preserved in notices
and `data/provenance.json`.
