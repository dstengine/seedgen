// Known-answer tests for every chain, and a cross-check of the TON side
// against the reference packages, which the app itself does not ship.
// Run: npm test
import { build } from "esbuild";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { mnemonicValidate, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { ed25519 } from "@noble/curves/ed25519.js";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

// Beside the sources, so the bundle resolves node_modules from here.
const out = path.resolve(".test", "wallet.mjs");
await build({ entryPoints: ["src/wallet.ts"], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const w = await import(out);

const w5 = (publicKey) =>
  WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.from(publicKey) })
    .address.toString({ bounceable: false, urlSafe: true });

const v4 = (publicKey) =>
  WalletContractV4.create({ workchain: 0, publicKey: Buffer.from(publicKey) })
    .address.toString({ bounceable: false, urlSafe: true });

// The BIP39 test phrase every wallet documents its paths against.
const abandon = "abandon ".repeat(11) + "about";
const a = await w.addressesOf(abandon);
assert.equal(a.ETH, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
assert.equal(a.BTC, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
assert.equal(a.SOL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
assert.equal(a.TRX, "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH");
console.log("ok  known answers: SOL ETH BTC TRX");

for (let i = 0; i < 200; i++) {
  const key = randomBytes(32);
  assert.equal(w.tonW5Address(key), w5(key));
}
console.log("ok  W5 address matches @ton/ton for 200 random keys");

for (let i = 0; i < 200; i++) {
  const key = randomBytes(32);
  assert.equal(w.tonV4Address(key), v4(key));
}
console.log("ok  v4R2 address matches @ton/ton for 200 random keys");

// Trust Wallet's own vectors, private key to address
// (wallet-core rust/tw_tests/tests/chains/ton/ton_address.rs).
for (const [priv, addr] of [
  ["5849481021e305dfdf9f0eaf87e07f15efec3fde8d8ed639c9fcf0bc351d998b", "UQAACKJfEIfI5vkht_w3NYk8k-OU5Xl_jq9XNmmkcPaUO-tB"],
  ["4a22d994755145e4a4ce7263bdb3a8a70e449c1fccdd299f80df862bd4dcb930", "UQA3fRa_AHKBo1Lu8QF5xm_fiCLi197NfoPbeta0VJyvKa76"],
  ["287d4c0fcc445173fe211e4ade3518c75cff7a9dd79070f54395058cdd53e485", "UQCbJ0QdlDmC0ofyCtH15PHBzrj9sMLoLjNjkgTYaxR8gn9z"],
  ["136e464280c4222a99ac34d5077a2edf11e4468a076741e495d9f31ca7939a1f", "UQAliC8yJh-Ru2uwEWgEaEV9LHEs0-c1blYr_XZe7CpEwm9D"],
]) assert.equal(w.tonV4Address(ed25519.getPublicKey(Buffer.from(priv, "hex"))), addr);
console.log("ok  v4R2 matches wallet-core's TON vectors");

for (let i = 0; i < 5; i++) {
  const wallet = await w.newWallet(12);
  assert.equal(wallet.phrase.split(" ").length, 12);
  assert.ok(validateMnemonic(wallet.phrase, wordlist));
  assert.match(wallet.addresses.TON, /^UQ/);
  // 12 words: TON comes from BIP39, so it changes with the BIP39 seed.
  assert.deepEqual(await w.addressesOf(wallet.phrase), wallet.addresses);
}
console.log("ok  12-word phrases are BIP39, TON via m/44'/607'/0' v4R2");

for (let i = 0; i < 5; i++) {
  const t0 = Date.now();
  const wallet = await w.newWallet();
  const words = wallet.phrase.split(" ");
  assert.equal(words.length, 24);
  assert.ok(await mnemonicValidate(words), "TON rejects the phrase");
  assert.ok(await w.isDualPhrase(wallet.phrase));
  const kp = await mnemonicToPrivateKey(words);
  assert.equal(wallet.addresses.TON, w5(kp.publicKey));
  console.log(`ok  phrase is BIP39 and TON, TON address matches (${Date.now() - t0} ms)`);
}
