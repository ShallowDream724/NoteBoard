# Pierre file icon sources

These SVG files are from [Pierre VSCode Icons](https://github.com/pierrecomputer/vscode-icons), pinned to commit `04a9028f0b227aaf820e9e73da2992af86ba0f26` and licensed under MIT. The original license is in `LICENSE.md` and is included in the application's public license output.

`manifest.json` records the upstream URL, byte size and SHA256 of every unmodified source file. Its selection covers all 53 file-type tokens in Pierre Trees' `TOKEN_DEFS`: `c` and `cpp` share `lang-c`, giving 52 distinct source SVGs. Seven supplemental icons cover closed and open folders, code, code blocks, configuration, feeds and extensions, giving 59 distinct SVGs in total. The manifest keeps the token-to-source mapping for reference.

Generate the application's static sprite and public license with Node.js, without downloading files or installing packages:

```sh
node scripts/generate-file-icons.mjs
node scripts/generate-file-icons.mjs --check
```

The generator verifies every source against the manifest and accepts only inert SVG geometry, with no scripts, event handlers, styles, external references, XML declarations or entities. Local paint definitions are validated and their IDs are prefixed with the source icon name to avoid collisions in the sprite.

Each symbol is named after its upstream SVG basename and uses a `0 0 16 16` viewBox. A source with a different viewBox is centered with its aspect ratio intact, and its original value is preserved as `data-source-view-box` on the symbol. `currentColor`, source opacity and duo-tone classes are retained. For Python (`lang-python`), Astro (`astro`) and Webpack (`webpack`), the background path with `class="bg"` uses `var(--file-icon-secondary, currentColor)` so the calling interface can supply its secondary theme color. The generator requires exactly one such path in each of these three sources.

The output is `src/assets/file-icons.svg`, intended for references such as `<use href="{spriteUrl}#lang-python" />`. The generated license is `public/licenses/pierre-vscode-icons.txt`.

To update the sources, intentionally select a new upstream commit, replace the source SVGs and license, update every URL/hash/byte size in the manifest, update the pinned constants in the generator, then regenerate and verify both outputs. Do not execute upstream build scripts.
