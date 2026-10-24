# seedgen

A seed phrase generator: one tap (or a swipe) makes a 12- or 24-word phrase and its
addresses for the largest coins: Solana, Ethereum, Bitcoin, BNB Smart Chain, XRP,
Tron, Zcash, Dogecoin, TON and Monero — the CoinGecko top 10 of 24 Oct 2026, with
USDT/USDC (no chain of their own, a note on the card), Hyperliquid (an EVM address,
named in the Ethereum row) and the tokenised-loan "Figure Heloc" set aside, plus TON.
"Copy all addresses" puts every row on the clipboard, one `Name: address` per line,
Trust Wallet's own ones last. Favourites are kept in
`localStorage`, deleted with two taps. Each address has a QR button (drawn in the page by `qrcode-generator`, no request).
Swipes on the card: left for a new wallet, right for the last one — the card follows the finger, then flies off while the next rises; up from the phrase or the card's head stars it, and a star flies to the Favourites tab. Up from the addresses stays a scroll (`touch-action: pan-x pan-up` on the phrase and the head; the browser keeps the way down). A short, fast flick commits like a long drag. Ships as a PWA and as a Telegram
Mini App. Spec: `~/mind/mobile/sites/seedgen.md`.

Lives at https://seedgen.uk/ (Vercel project `seedgen`; DNS at GoDaddy,
`www` 308s to the apex). It started at `sol2go.lol/seedgen/`, which now
301s here from sol2go's `vercel.json`.

Every push to `main` deploys to production (the Vercel project is linked to
this repo); other branches get preview deployments.

The page is dated by the last commit that changed `src/`; `npm run build`
writes that date to `src/updated.txt`, which Vercel's build falls back on
(it has no git history to read) for the sitemap's `lastmod`. Build locally
and commit it with the change.

## The phrase

12 or 24 words, the reader's choice (remembered in `localStorage`).

24 BIP39 words are drawn until the phrase is also a valid TON mnemonic (one
in ~256 is), so the same words import everywhere:

| Chain | Derivation | Wallets |
|---|---|---|
| Solana | `m/44'/501'/0'/0'` (SLIP-10 ed25519) | Phantom, Solflare, Backpack |
| Ethereum | `m/44'/60'/0'/0/0` | MetaMask, Rabby |
| Bitcoin | `m/84'/0'/0'/0/0`, native SegWit | any BIP84 wallet |
| BNB Smart Chain | `m/44'/60'/0'/0/0`, the Ethereum address | Trust Wallet, MetaMask |
| XRP | `m/44'/144'/0'/0/0`, base58 in Ripple's alphabet | Xaman, Trust Wallet |
| Tron | `m/44'/195'/0'/0/0` | TronLink, Trust Wallet |
| Zcash | `m/44'/133'/0'/0/0`, transparent `t1…` (shielded needs a Zcash wallet's own keys) | Trust Wallet |
| Dogecoin | `m/44'/3'/0'/0/0`, P2PKH `D…` | Trust Wallet, Exodus |
| Monero | `m/44'/128'/0'/0/0` (secp256k1 key reduced mod l = spend key; view key = keccak256(spend) reduced) | BIP39 import only; not a native 25-word seed. Trust Wallet has no Monero |
| TON, 24 words | TON mnemonic → wallet W5 (v5r1), non-bounceable `UQ…` | Tonkeeper, MyTonWallet |
| TON, 12 words | `m/44'/607'/0'` (SLIP-10 ed25519) → wallet v4R2 | Trust Wallet |

A TON mnemonic is always 24 words, so a 12-word phrase is BIP39 only, and
its TON address is the one Trust Wallet derives (wallet-core `tw_ton`:
that path, v4R2). Tonkeeper will not import it. The other way round, Trust
Wallet reads a 24-word phrase as BIP39 for TON too and shows a different TON
address from Tonkeeper's; the card names the wallet on the TON row.

## Trust Wallet

Trust Wallet takes any phrase from here and reads it as BIP39, with its own
defaults (wallet-core `registry.json`): Ethereum, Bitcoin (BIP84) and Tron
(and BNB, XRP, Zcash, Dogecoin) match the card; Solana is `m/44'/501'/0'` (Phantom's has one more `/0'`) and
TON is `m/44'/607'/0'` v4R2 for any length. The card shows those two under
"In Trust Wallet" wherever they differ from the rows above, and the tests
hold both to wallet-core's mnemonic vectors. Favourites saved before this
get their Trust Wallet addresses derived when opened.

## SEO

One page, so the work is on it: the head keyword in the title, `h1` and
description; a static FAQ answering the queries the page can win (import
into Trust Wallet, Phantom vs Trust Wallet Solana address, 12 or 24 words,
offline); JSON-LD with `WebApplication` and `FAQPage`; sitemap with every
protocol field, `lastmod` from `src/updated.txt`.

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
- A notice on the page follows `navigator.onLine`: online it suggests
  airplane mode before generating, since the app keeps working; offline it
  says nothing can leave the device. The service worker makes the page open
  offline too once it has been loaded.
- The source is public (this repo), linked from the notice and the "How
  the seed phrase is made" section. Inside Telegram the link opens through
  `WebApp.openLink`.

## Commands

```
npm run build   # dist/
npm test        # known-answer vectors for every chain; TON against @ton/ton and wallet-core
npm run serve   # dist/ on :4173
npm run e2e     # Chromium at 320px, light and dark: generate, 12/24, swipe, favourites, offline notice
```

## License

[MIT](LICENSE).
