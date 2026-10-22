// Drives the built page in Chromium: generation, the longest word at
// 320px, favourites with the two-tap delete, swipes, offline reload, and
// that the page makes no request beyond its own files.
// Run: npm run build && npm run serve & npm run e2e
import { chromium, devices } from "playwright";
import assert from "node:assert/strict";

const URL = process.env.URL || "http://localhost:4173/";
const shots = process.env.SHOTS || ".test";
const browser = await chromium.launch();

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ ...devices["iPhone SE"], viewport: { width: 320, height: 640 }, colorScheme: scheme, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [], foreign = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !r.url().startsWith(URL) && foreign.push(r.url()));

  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll("[data-words] li").length === 24);
  const first = await page.textContent("[data-words]");
  assert.equal((await page.$$("[data-addresses] li")).length, 6);

  // Longest BIP39 word in every cell must fit its cell.
  const overflow = await page.evaluate(() => {
    const lis = [...document.querySelectorAll("[data-words] li")];
    const saved = lis.map((l) => l.textContent);
    lis.forEach((l) => (l.textContent = "champion"));
    const bad = lis.filter((l) => l.scrollWidth > l.clientWidth + 1).length;
    lis.forEach((l, i) => (l.textContent = saved[i]));
    return bad;
  });
  assert.equal(overflow, 0, "a seed word overflows its cell at 320px");
  await page.screenshot({ path: `${shots}/gen-320-${scheme}.png`, fullPage: true });

  await page.click("[data-generate]");
  await page.waitForFunction((f) => document.querySelector("[data-words]").textContent !== f, first);
  const second = await page.textContent("[data-words]");

  // Swipe right goes back to the first wallet.
  const box = await page.locator("[data-wallet]").boundingBox();
  const y = box.y + 40;
  await page.locator("[data-wallet]").dispatchEvent("pointerdown", { pointerType: "touch", clientX: 60, clientY: y, isPrimary: true });
  await page.locator("[data-wallet]").dispatchEvent("pointermove", { pointerType: "touch", clientX: 200, clientY: y + 5 });
  await page.locator("[data-wallet]").dispatchEvent("pointerup", { pointerType: "touch", clientX: 200, clientY: y + 5 });
  assert.equal(await page.textContent("[data-words]"), first, "swipe right did not go back");

  // Star it, then delete from favourites: one tap arms, the second deletes.
  await page.click("[data-star]");
  assert.equal(await page.getAttribute("[data-star]", "aria-pressed"), "true");
  await page.click('.tab[data-view="fav"]');
  assert.equal(await page.textContent("[data-fav-count]"), "1");
  await page.screenshot({ path: `${shots}/fav-320-${scheme}.png`, fullPage: true });
  await page.click(".fav-del");
  assert.equal(await page.textContent(".fav-del"), "Sure?");
  await page.screenshot({ path: `${shots}/fav-armed-320-${scheme}.png` });
  await page.click(".fav-del");
  assert.equal((await page.$$(".fav")).length, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("seedgen.favourites")), "[]");

  // An armed delete disarms itself.
  await page.click('.tab[data-view="gen"]');
  await page.click("[data-star]");
  await page.click('.tab[data-view="fav"]');
  await page.click(".fav-del");
  await page.waitForTimeout(3200);
  assert.equal(await page.textContent(".fav-del"), "Delete");
  assert.equal((await page.$$(".fav")).length, 1);

  // 12 words: one tap switches, the choice survives a reload, and TON
  // says where those words open.
  await page.click('.tab[data-view="gen"]');
  await page.click('[data-words-count="12"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-words] li").length === 12);
  assert.match(await page.textContent("[data-addresses]"), /TON \(Gram\) · Trust Wallet/);
  // 12 words: TON above is already Trust's, so only Solana differs.
  await page.waitForFunction(() => document.querySelectorAll("[data-trust-list] li").length === 1);
  assert.match(await page.textContent("[data-trust-list]"), /Solana · Trust Wallet/);
  await page.screenshot({ path: `${shots}/gen12-320-${scheme}.png` });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("[data-words] li").length === 12);
  await page.click('[data-words-count="24"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-words] li").length === 24);
  assert.match(await page.textContent("[data-addresses]"), /TON \(Gram\) · Tonkeeper/);
  await page.waitForFunction(() => document.querySelectorAll("[data-trust-list] li").length === 2);
  assert.match(await page.textContent("[data-trust-text]"), /Ethereum, Bitcoin and Tron are the same/);

  // Offline after the first visit.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert.equal(await page.textContent("[data-net-title]"), "Works offline");
  assert.equal(await page.getAttribute('[data-net] a', "href"), "https://github.com/dstengine/seedgen");
  await ctx.setOffline(true);
  // The notice follows the connection without a reload...
  await page.waitForFunction(() => document.querySelector("[data-net]").dataset.state === "offline");
  await page.screenshot({ path: `${shots}/offline-320-${scheme}.png` });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("[data-words] li").length === 24);
  // ...and says so on a page opened offline.
  assert.equal(await page.textContent("[data-net-title]"), "You're offline");
  await ctx.setOffline(false);

  assert.deepEqual(errors, [], "console errors");
  assert.deepEqual(foreign, [], "requests outside the page's own files");
  assert.notEqual(first, second);
  console.log(`ok  ${scheme}: generate, 12/24, swipe back, favourite, two-tap delete, offline + notice, no outside requests`);
  await ctx.close();
}
await browser.close();
