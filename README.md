# Perk Finder

A fast, local RuneScape perk calculator. Native Rust search engine, 
text-based interface, and one self-contained Windows executable.

## Run

Download **[Perk Finder.exe](./Perk%20Finder.exe)** using GitHub's **Download raw
file** button, then double-click it. The calculator opens in your default
browser. **The EXE is all you need**: no source folder, installer, npm, Node,
Rust installation, or companion files. Windows x64 only.

Calculations and interface assets are embedded and work offline. Game artwork
is not loaded; outbound Wiki reference links require internet. The application
serves only on `127.0.0.1`, chooses an available port, and shuts down about
90 seconds after its browser tabs close.

Based on the [RuneScape Wiki perk calculator](https://runescape.wiki/w/Calculator:Perks/Search).
Wiki-derived code, data and UI use **CC BY-NC-SA 3.0**, which includes
non-commercial and share-alike restrictions. Dependency licences and source
attribution are included in [third-party notices](source/ui/app/THIRD-PARTY-NOTICES.txt)
and **embedded in the EXE**, accessible from the app footer. Preserve applicable
licences when redistributing or modifying the project.

RuneScape is a trademark of Jagex Limited. This project is not affiliated with
Jagex or the RuneScape Wiki.
