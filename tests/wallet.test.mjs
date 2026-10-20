// Known-answer tests for every chain, and a cross-check of the TON side
// against the reference packages, which the app itself does not ship.
// Run: npm test
import { build } from "esbuild";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { mnemonicValidate, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1 } from "@ton/ton";

// Beside the sources, so the bundle resolves node_modules from here.
const out = path.resolve(".test", "wallet.mjs");
await build({ entryPoints: ["src/wallet.ts"], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const w = await import(out);

const w5 = (publicKey) =>
  WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.from(publicKey) })
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
