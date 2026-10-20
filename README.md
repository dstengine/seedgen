# seedgen

A seed phrase generator: one tap (or a swipe) makes a 12- or 24-word phrase and its
Solana, Ethereum, Bitcoin, Tron and TON addresses. Favourites are kept in
`localStorage`, deleted with two taps. Ships as a PWA and as a Telegram
Mini App. Spec: `~/mind/mobile/sites/seedgen.md`.

To start with it is served at `sol2go.lol/seedgen/` through a rewrite in
sol2go's `vercel.json`; every URL in `dist/` is relative, so the same build
serves from a domain root as well.

## The phrase

12 or 24 words, the reader's choice (remembered in `localStorage`).

24 BIP39 words are drawn until the phrase is also a valid TON mnemonic (one
in ~256 is), so the same words import everywhere:

| Chain | Derivation | Wallets |
|---|---|---|
| Solana | `m/44'/501'/0'/0'` (SLIP-10 ed25519) | Phantom, Solflare, Backpack |
| Ethereum | `m/44'/60'/0'/0/0` | MetaMask, Rabby |
| Bitcoin | `m/84'/0'/0'/0/0`, native SegWit | any BIP84 wallet |
| Tron | `m/44'/195'/0'/0/0` | TronLink, Trust Wallet |
| TON, 24 words | TON mnemonic → wallet W5 (v5r1), non-bounceable `UQ…` | Tonkeeper, MyTonWallet |
| TON, 12 words | `m/44'/607'/0'` (SLIP-10 ed25519) → wallet v4R2 | Trust Wallet |

A TON mnemonic is always 24 words, so a 12-word phrase is BIP39 only, and
its TON address is the one Trust Wallet derives (wallet-core `tw_ton`:
that path, v4R2). Tonkeeper will not import it. The other way round, Trust
Wallet reads a 24-word phrase as BIP39 for TON too and shows a different TON
address from Tonkeeper's; the card names the wallet on the TON row.

The TON address is computed in `src/wallet.ts` by hashing the wallet's
StateInit directly (W5 and v4R2), rather than through `@ton/ton`, which would add 270 KB
for one hash. `@ton/ton` and `@ton/crypto` stay as dev dependencies so the
tests can hold the result to them.

## Security

- Randomness: `crypto.getRandomValues` via `@scure/bip39`; keys via the
  audited `@noble`/`@scure` libraries and Web Crypto PBKDF2.
- No network: the page makes no request beyond its own files (the e2e test
  asserts it), and the CSP (`connect-src 'self'`) forbids one.
- Telegram's `telegram-web-app.js` is loaded only when the page is opened as
  a Mini App (`tgWebAppData` in the URL), never on the open web.
- Favourites are stored unencrypted on the device. The page says so.

## Commands

```
npm run build   # dist/
npm test        # known-answer vectors for every chain; TON against @ton/ton and wallet-core
npm run serve   # dist/ on :4173
npm run e2e     # Chromium at 320px, light and dark: generate, 12/24, swipe, favourites, offline
```
