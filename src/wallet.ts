// One phrase, the top coins by market cap. Everything here runs in the reader's browser and
// nothing it computes leaves it: no request is made while generating, and
// the page's CSP forbids one (see index.html).
//
// A 24-word phrase is chosen so that it is also a valid TON mnemonic. A
// BIP39 phrase carries its own checksum; a TON one is any 24 words from the
// same list whose HMAC passes TON's "basic seed" test, which one random
// phrase in 256 does. So we draw BIP39 entropy until the phrase passes both,
// and the same words import into Phantom, MetaMask, TronLink, a Bitcoin
// wallet and Tonkeeper alike.
//
// A TON mnemonic is always 24 words, so a 12-word phrase is BIP39 only and
// its TON address is the one Trust Wallet derives from BIP39:
// m/44'/607'/0' on ed25519, wallet v4R2 (wallet-core's tw_ton).
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58, base58check, base58xrp, base64urlnopad, bech32 } from "@scure/base";

export type Chain = "SOL" | "ETH" | "BTC" | "BNB" | "XRP" | "TRX" | "ZEC" | "DOGE" | "TON" | "XMR";

export interface Wallet {
  id: string;
  phrase: string;
  createdAt: string;
  addresses: Record<Chain, string>;
  /** What Trust Wallet shows for the same phrase where it differs from
   *  `addresses`. Absent on favourites saved before it existed. */
  trust?: TrustAddresses;
}

/** Trust Wallet reads every phrase as BIP39 and uses its own defaults for
 *  two chains: Solana at m/44'/501'/0' (Phantom adds a /0'), and TON at
 *  m/44'/607'/0' as wallet v4R2 — for 24 words too, where Tonkeeper reads
 *  the TON mnemonic instead. The secp256k1 chains match as they are.
 *  Paths from wallet-core's registry.json. */
export type TrustAddresses = { SOL: string; TON: string };
export const TRUST_PATHS = { SOL: "m/44'/501'/0'", TON: "m/44'/607'/0'" } as const;

/** Order on screen. Solana first, then roughly by market cap. BNB Smart
 *  Chain is an EVM chain, so its address is Ethereum's; it gets a row of its
 *  own because that is where people look for it. */
export const CHAINS: { id: Chain; name: string; path: string; note: string }[] = [
  { id: "SOL", name: "Solana", path: "m/44'/501'/0'/0'", note: "Phantom, Solflare, Backpack" },
  { id: "ETH", name: "Ethereum", path: "m/44'/60'/0'/0/0", note: "MetaMask, Trust Wallet, Rabby; any EVM chain, Hyperliquid too" },
  { id: "BTC", name: "Bitcoin", path: "m/84'/0'/0'/0/0", note: "Native SegWit (bc1…) · Trust Wallet" },
  { id: "BNB", name: "BNB Smart Chain", path: "m/44'/60'/0'/0/0", note: "Same 0x address as Ethereum · Trust Wallet, MetaMask" },
  { id: "XRP", name: "XRP", path: "m/44'/144'/0'/0/0", note: "Xaman, Trust Wallet" },
  { id: "TRX", name: "Tron", path: "m/44'/195'/0'/0/0", note: "TronLink, Trust Wallet" },
  { id: "ZEC", name: "Zcash", path: "m/44'/133'/0'/0/0", note: "Transparent (t1…) · Trust Wallet" },
  { id: "DOGE", name: "Dogecoin", path: "m/44'/3'/0'/0/0", note: "Legacy (D…) · Trust Wallet, Exodus" },
  { id: "TON", name: "TON (Gram)", path: "TON mnemonic", note: "W5 · Tonkeeper, MyTonWallet" },
  { id: "XMR", name: "Monero", path: "m/44'/128'/0'/0/0", note: "Main address · BIP39 import, Ledger path" },
];

export type WordCount = 12 | 24;

/** How a phrase of this length reaches TON: the TON row of the table. */
export const TON_SCHEME: Record<WordCount, { path: string; contract: string; wallets: string }> = {
  24: { path: "TON mnemonic", contract: "W5", wallets: "Tonkeeper, MyTonWallet" },
  12: { path: "m/44'/607'/0'", contract: "v4R2", wallets: "Trust Wallet" },
};

export const wordCount = (phrase: string): WordCount => (phrase.trim().split(/\s+/).length === 12 ? 12 : 24);

const subtle = globalThis.crypto.subtle;

async function pbkdf2Sha512(password: Uint8Array, salt: string, iterations: number): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", password as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-512", salt: utf8ToBytes(salt) as BufferSource, iterations },
    key,
    512,
  );
  return new Uint8Array(bits);
}

// TON's mnemonic scheme, as @ton/crypto implements it.
function tonEntropy(phrase: string): Uint8Array {
  return hmac(sha512, utf8ToBytes(phrase), new Uint8Array(0));
}

async function isTonBasicSeed(phrase: string): Promise<boolean> {
  const seed = await pbkdf2Sha512(tonEntropy(phrase), "TON seed version", Math.max(1, Math.floor(100000 / 256)));
  return seed[0] === 0;
}

/** True when the phrase is both a BIP39 phrase and a TON mnemonic. */
export async function isDualPhrase(phrase: string): Promise<boolean> {
  return validateMnemonic(phrase, wordlist) && (await isTonBasicSeed(phrase));
}

export async function newPhrase(words: WordCount = 24): Promise<string> {
  if (words === 12) return generateMnemonic(wordlist, 128);
  for (;;) {
    const phrase = generateMnemonic(wordlist, 256);
    if (await isTonBasicSeed(phrase)) return phrase;
  }
}

function secpAt(root: HDKey, path: string): Uint8Array {
  const key = root.derive(path);
  if (!key.privateKey) throw new Error(`no key at ${path}`);
  return key.privateKey;
}

function evmAddressBytes(priv: Uint8Array): Uint8Array {
  const pub = secp256k1.getPublicKey(priv, false);
  return keccak_256(pub.subarray(1)).subarray(-20);
}

function eip55(addr: Uint8Array): string {
  const hex = bytesToHex(addr);
  const hash = bytesToHex(keccak_256(utf8ToBytes(hex)));
  let out = "0x";
  for (let i = 0; i < hex.length; i++) out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  return out;
}

function tronAddress(priv: Uint8Array): string {
  const body = new Uint8Array(21);
  body[0] = 0x41;
  body.set(evmAddressBytes(priv), 1);
  return base58check(sha256).encode(body);
}

/** Legacy pay-to-public-key-hash: version bytes + hash160, base58check. */
function p2pkh(priv: Uint8Array, version: number[], encode = base58check(sha256).encode): string {
  const hash = ripemd160(sha256(secp256k1.getPublicKey(priv, true)));
  return encode(new Uint8Array([...version, ...hash]));
}

// XRP is the same shape in Ripple's own base58 alphabet.
function xrpAddress(priv: Uint8Array): string {
  return p2pkh(priv, [0], (body) => {
    const sum = sha256(sha256(body)).subarray(0, 4);
    return base58xrp.encode(new Uint8Array([...body, ...sum]));
  });
}

function btcSegwit(priv: Uint8Array): string {
  const program = ripemd160(sha256(secp256k1.getPublicKey(priv, true)));
  return bech32.encode("bc", [0, ...bech32.toWords(program)]);
}

// SLIP-0010 for ed25519: hardened steps only, which is what Phantom's
// m/44'/501'/0'/0' is.
function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let I = hmac(sha512, utf8ToBytes("ed25519 seed"), seed);
  for (const part of path.split("/").slice(1)) {
    const index = (parseInt(part, 10) | 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data.set(I.subarray(0, 32), 1);
    new DataView(data.buffer).setUint32(33, index);
    I = hmac(sha512, I.subarray(32), data);
  }
  return I.subarray(0, 32);
}

// A TON wallet's address is the hash of the contract it would deploy: the
// wallet code, plus a data cell holding the public key. @ton/ton computes
// it through @ton/core and @ton/crypto — 270 KB for one hash — so the cell
// hashing is written out here instead, for the two wallets we make, both
// mainnet, workchain 0, default subwallet. tests/wallet.test.mjs holds the
// results to @ton/ton's and to wallet-core's vectors.
//
// W5 (v5r1), the one Tonkeeper creates. Its wallet id is networkGlobalId
// (-239, mainnet) XOR the client context (workchain 0, version v5r1,
// subwallet 0), as storeWalletIdV5R1 packs it.
const W5 = { hash: hexToBytes("20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f"), depth: 6 };
const W5_WALLET_ID = 0x7fffff11;
// v4R2, the one Trust Wallet uses. Wallet id 698983191 + workchain.
const V4R2 = { hash: hexToBytes("feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0"), depth: 7 };
const V4_WALLET_ID = 698983191;

/** Bits written MSB-first, then TON's completion tag: a 1 and zeros. */
class Bits {
  private bytes: number[] = [];
  length = 0;
  push(value: number | bigint, width: number) {
    for (let i = width - 1; i >= 0; i--) this.bit(Number((BigInt(value) >> BigInt(i)) & 1n));
    return this;
  }
  bit(b: number) {
    if (this.length % 8 === 0) this.bytes.push(0);
    if (b) this.bytes[this.bytes.length - 1] |= 0x80 >> this.length % 8;
    this.length++;
    return this;
  }
  padded(): Uint8Array {
    const out = [...this.bytes];
    if (this.length % 8) out[out.length - 1] |= 0x80 >> this.length % 8;
    return new Uint8Array(out);
  }
}

/** Representation hash of an ordinary cell (level 0). */
function cellHash(bits: Bits, refs: { hash: Uint8Array; depth: number }[]): Uint8Array {
  const d2 = Math.floor(bits.length / 8) + Math.ceil(bits.length / 8);
  const parts = [new Uint8Array([refs.length, d2]), bits.padded()];
  for (const r of refs) parts.push(new Uint8Array([r.depth >> 8, r.depth & 0xff]));
  for (const r of refs) parts.push(r.hash);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return sha256(all);
}

function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Non-bounceable user-friendly address (UQ…) of a wallet contract. */
function walletAddress(code: { hash: Uint8Array; depth: number }, data: Bits): string {
  // StateInit: no split_depth, no special, code, data, no library.
  const init = cellHash(new Bits().push(0b00110, 5), [code, { hash: cellHash(data, []), depth: 0 }]);
  const raw = new Uint8Array(36);
  raw[0] = 0x51; // non-bounceable, mainnet — as wallets show their own
  raw[1] = 0x00; // workchain 0
  raw.set(init, 2);
  const crc = crc16(raw.subarray(0, 34));
  raw[34] = crc >> 8;
  raw[35] = crc & 0xff;
  return base64urlnopad.encode(raw);
}

export function tonW5Address(publicKey: Uint8Array): string {
  const data = new Bits().push(1, 1).push(0, 32).push(W5_WALLET_ID, 32);
  for (const b of publicKey) data.push(b, 8);
  data.bit(0); // no extensions
  return walletAddress(W5, data);
}

export function tonV4Address(publicKey: Uint8Array): string {
  const data = new Bits().push(0, 32).push(V4_WALLET_ID, 32);
  for (const b of publicKey) data.push(b, 8);
  data.bit(0); // no plugins
  return walletAddress(V4R2, data);
}

async function tonAddress(phrase: string, seed: Uint8Array): Promise<string> {
  if (wordCount(phrase) === 12) return tonV4Address(ed25519.getPublicKey(slip10Ed25519(seed, "m/44'/607'/0'")));
  const tonSeed = await pbkdf2Sha512(tonEntropy(phrase), "TON default seed", 100000);
  return tonW5Address(ed25519.getPublicKey(tonSeed.subarray(0, 32)));
}

// Monero. The native 25-word seed uses its own wordlist, so a BIP39 phrase
// cannot be one; instead the secp256k1 key at m/44'/128'/0'/0/0 (the path
// Ledger and Ian Coleman's tool use) is reduced mod l to be the spend key,
// as Monero does. The view key is keccak256(spend) reduced the same way,
// and the address is 0x12 + both public keys + a 4-byte keccak checksum,
// in Monero's block base58 (8 bytes -> 11 characters).
const ED_L = ed25519.Point.Fn.ORDER;
const scReduce32 = (b: Uint8Array): bigint => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n % ED_L;
};
const XMR_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const XMR_BLOCK = [0, 2, 3, 5, 6, 7, 9, 10, 11];

function moneroBase58(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 8) {
    const block = data.subarray(i, i + 8);
    let n = 0n;
    for (const b of block) n = (n << 8n) | BigInt(b);
    let chunk = "";
    for (let j = 0; j < XMR_BLOCK[block.length]; j++) {
      chunk = XMR_ALPHABET[Number(n % 58n)] + chunk;
      n /= 58n;
    }
    out += chunk;
  }
  return out;
}

export function moneroAddress(spendPriv: Uint8Array): string {
  const spend = scReduce32(spendPriv);
  const spendLE = new Uint8Array(32);
  for (let i = 0, n = spend; i < 32; i++, n >>= 8n) spendLE[i] = Number(n & 0xffn);
  const view = scReduce32(keccak_256(spendLE));
  const body = new Uint8Array(65);
  body[0] = 0x12;
  body.set(ed25519.Point.BASE.multiply(spend).toBytes(), 1);
  body.set(ed25519.Point.BASE.multiply(view).toBytes(), 33);
  const full = new Uint8Array(69);
  full.set(body);
  full.set(keccak_256(body).subarray(0, 4), 65);
  return moneroBase58(full);
}

export async function addressesOf(phrase: string): Promise<Record<Chain, string>> {
  const seed = await mnemonicToSeed(phrase);
  const root = HDKey.fromMasterSeed(seed);
  const sol = base58.encode(ed25519.getPublicKey(slip10Ed25519(seed, "m/44'/501'/0'/0'")));
  const eth = eip55(evmAddressBytes(secpAt(root, "m/44'/60'/0'/0/0")));
  return {
    SOL: sol,
    ETH: eth,
    BTC: btcSegwit(secpAt(root, "m/84'/0'/0'/0/0")),
    BNB: eth,
    XRP: xrpAddress(secpAt(root, "m/44'/144'/0'/0/0")),
    TRX: tronAddress(secpAt(root, "m/44'/195'/0'/0/0")),
    ZEC: p2pkh(secpAt(root, "m/44'/133'/0'/0/0"), [0x1c, 0xb8]),
    DOGE: p2pkh(secpAt(root, "m/44'/3'/0'/0/0"), [0x1e]),
    TON: await tonAddress(phrase, seed),
    XMR: moneroAddress(secpAt(root, "m/44'/128'/0'/0/0")),
  };
}

export async function trustAddressesOf(phrase: string): Promise<TrustAddresses> {
  const seed = await mnemonicToSeed(phrase);
  return {
    SOL: base58.encode(ed25519.getPublicKey(slip10Ed25519(seed, TRUST_PATHS.SOL))),
    TON: tonV4Address(ed25519.getPublicKey(slip10Ed25519(seed, TRUST_PATHS.TON))),
  };
}

export async function newWallet(words: WordCount = 24): Promise<Wallet> {
  const phrase = await newPhrase(words);
  return {
    id: bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(8))),
    phrase,
    createdAt: new Date().toISOString(),
    addresses: await addressesOf(phrase),
    trust: await trustAddressesOf(phrase),
  };
}
