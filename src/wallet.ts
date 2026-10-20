// One phrase, five chains. Everything here runs in the reader's browser and
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
import { base58, base58check, base64urlnopad, bech32 } from "@scure/base";

export type Chain = "SOL" | "ETH" | "BTC" | "TRX" | "TON";

export interface Wallet {
  id: string;
  phrase: string;
  createdAt: string;
  addresses: Record<Chain, string>;
}

/** Order on screen. Solana first: the site this opens under is about it. */
export const CHAINS: { id: Chain; name: string; path: string; note: string }[] = [
  { id: "SOL", name: "Solana", path: "m/44'/501'/0'/0'", note: "Phantom, Solflare, Backpack" },
  { id: "ETH", name: "Ethereum", path: "m/44'/60'/0'/0/0", note: "MetaMask, Rabby; any EVM chain" },
  { id: "BTC", name: "Bitcoin", path: "m/84'/0'/0'/0/0", note: "Native SegWit (bc1…)" },
  { id: "TRX", name: "Tron", path: "m/44'/195'/0'/0/0", note: "TronLink, Trust Wallet" },
  { id: "TON", name: "TON (Gram)", path: "TON mnemonic", note: "W5 · Tonkeeper, MyTonWallet" },
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

export async function addressesOf(phrase: string): Promise<Record<Chain, string>> {
  const seed = await mnemonicToSeed(phrase);
  const root = HDKey.fromMasterSeed(seed);
  const sol = base58.encode(ed25519.getPublicKey(slip10Ed25519(seed, "m/44'/501'/0'/0'")));
  return {
    SOL: sol,
    ETH: eip55(evmAddressBytes(secpAt(root, "m/44'/60'/0'/0/0"))),
    BTC: btcSegwit(secpAt(root, "m/84'/0'/0'/0/0")),
    TRX: tronAddress(secpAt(root, "m/44'/195'/0'/0/0")),
    TON: await tonAddress(phrase, seed),
  };
}

export async function newWallet(words: WordCount = 24): Promise<Wallet> {
  const phrase = await newPhrase(words);
  return {
    id: bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(8))),
    phrase,
    createdAt: new Date().toISOString(),
    addresses: await addressesOf(phrase),
  };
}
