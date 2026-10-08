# Perk Finder

A fast, local RuneScape perk calculator. Native Rust search engine, neutral
text-based interface, and one self-contained Windows executable.

## Run

Download **[Perk Finder.exe](./Perk%20Finder.exe)** using GitHub's **Download raw
file** button, then double-click it. The calculator opens in your default
browser. **The EXE is all you need**: no source folder, installer, npm, Node,
Rust installation, or companion files. Windows x64 only.

Calculations and interface assets are embedded and work offline. Game artwork
is not loaded; outbound Wiki reference links require internet. The application
serves only on `127.0.0.1`, chooses an available port, and shuts down about
90 seconds after its browser tabs close. The executable is unsigned.

## Features

- Regular and ancient weapon, armour, and tool gizmos.
- One- or two-perk targets, rank selection, level/potion controls and filters.
- Exhaustive search within the selected material limits, using parallel Rust
  evaluation and exact bounds to skip provably impossible combinations.
- Sortable results, material recipes, probabilities and level recommendations.
- No calculator downloads or package-manager dependency at runtime.

## Performance and accuracy

**Impatient 4 + Mobile, Ancient Armour, extreme potion at level 120**, with
every effective level from 1 to 137 and all eligible materials: **20–26 ms**
search time on the development PC, returning **5,050 recipes**. Set the
advanced distinct-material limit to **9** to reproduce this scope. Browser
rendering is separate (approximately 0.58 seconds); other searches may take
longer. This is not a universal sub-100ms guarantee.

All 5,050 returned probabilities were checked against the original Wiki
calculator at their selected best levels, with maximum absolute difference
**2.22e-16**. Additional Rust fixtures cover dice distributions and Wiki edge
cases. These checks are not a proof of parity for every possible search.

Against [Runescape-perk-solver](https://github.com/ppartous/Runescape-perk-solver),
the smaller default six-material search measured **2.14 ms versus about 7 ms**.
Its expanded all-material search did not finish within a 15-second cutoff;
ours took approximately 20 ms. The output/level scopes differ, so this is not
a blanket speedup claim. See [source notes](source/README.md) and
[recorded measurements](source/benchmarks/) for methodology and limitations.

## Source and development

```text
source/          Rust engine, server, embedded UI, tests and build script
Perk Finder.exe  Standalone Windows x64 application
README.md        This guide
```

With a Windows Rust development toolchain installed:

```powershell
.\source\build.ps1 -Test
.\source\tests\standalone.ps1
.\source\tests\privacy.ps1
```

No Node/npm is needed to build the app. Edit the plain UI files in
`source/ui/app/` or Rust files in `source/src/`, then rebuild. Close the
running EXE before replacing it. The standalone test copies only the EXE to
a temporary directory, clears PATH, checks embedded assets/notices, and runs
the benchmark. [More developer details](source/README.md).

The build script strips symbols and remaps local paths before releasing the
EXE. Build intermediates stay outside the repository. The privacy scan checks
publishable files, including the archive and executable. Do not manually
upload `.git/`, temporary build directories, or development backups.

The GitHub Actions workflow builds, tests and uploads the Windows executable.
It has not yet been run on GitHub. This repository has not been published by
the local setup process.

## Attribution and licences

Based on the [RuneScape Wiki perk calculator](https://runescape.wiki/w/Calculator:Perks/Search).
Wiki-derived code, data and UI use **CC BY-NC-SA 3.0**, which includes
non-commercial and share-alike restrictions. Dependency licences and source
attribution are included in [third-party notices](source/ui/app/THIRD-PARTY-NOTICES.txt)
and **embedded in the EXE**, accessible from the app footer. Preserve applicable
licences when redistributing or modifying the project.

RuneScape is a trademark of Jagex Limited. This project is not affiliated with
Jagex or the RuneScape Wiki.
