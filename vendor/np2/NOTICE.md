# Upstream components

NP2-wasm by irori, based on Neko Project II.

- Source: https://github.com/irori/np2-wasm
- Prebuilt distribution: https://irori.github.io/np2-wasm/
- Downloaded: 2026-10-03
- License: BSD-3-Clause; see LICENSE in this directory.
- Local copies: np2-wasm.js, np21.js, np21.wasm, font.bmp.
- The launcher uses NP21 (i386) for compatibility with the disk's VEM486 driver.
- font_cn.bmp is copied from the user's existing local game bundle, not from upstream.

The local wrapper removes the unused NP2 factory; NP21 remains unchanged.
SHA256SUMS.json records hashes of the shipped runtime files, including this wrapper.
The original wrapper and unused NP2 core are retained in the sibling maintenance directory.
