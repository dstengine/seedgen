import qrcode from "qrcode-generator";
import { CHAINS, TON_SCHEME, TRUST_PATHS, addressesOf, newWallet, trustAddressesOf, wordCount, type Chain, type Wallet, type WordCount } from "./wallet";

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---------------------------------------------------------------- favourites

const STORE = "seedgen.favourites";

function loadFavs(): Wallet[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveFavs(list: Wallet[]): boolean {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
    return true;
  } catch {
    toast("This browser won't keep favourites (private mode?)");
    return false;
  }
}

let favs = loadFavs();

// The length the reader picked last, kept between visits.
const WORDS = "seedgen.words";
let words: WordCount = 24;
try {
  if (localStorage.getItem(WORDS) === "12") words = 12;
} catch {}
const isFav = (w: Wallet) => favs.some((f) => f.id === w.id);

// ---------------------------------------------------------------- telegram

interface TgWebApp {
  ready(): void;
  expand(): void;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium"): void;
    notificationOccurred(type: "success" | "warning"): void;
  };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void };
  onEvent(name: string, cb: () => void): void;
  disableVerticalSwipes?(): void;
  openLink?(url: string): void;
}

let tg: TgWebApp | undefined;

// Telegram opens a Mini App with tgWebAppData in the hash. Only then is its
// script fetched: on the open web it would be a third party's code running
// beside a seed phrase, for nothing.
function inTelegram(): boolean {
  return /tgWebApp(Data|Platform|Version)=/.test(location.hash + location.search);
}

function loadTelegram(): Promise<void> {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = () => {
      tg = (window as unknown as { Telegram?: { WebApp: TgWebApp } }).Telegram?.WebApp;
      if (tg) {
        document.documentElement.classList.add("tma");
        tg.ready();
        tg.expand();
        // Our own swipe changes the wallet; without this the same gesture
        // downwards would also close the app.
        tg.disableVerticalSwipes?.();
        applyTheme();
        tg.onEvent("themeChanged", applyTheme);
        tg.BackButton.onClick(() => show("gen"));
      }
      resolve();
    };
    s.onerror = () => resolve();
    document.head.append(s);
  });
}

function applyTheme() {
  if (!tg) return;
  const p = tg.themeParams;
  const root = document.documentElement;
  root.dataset.theme = tg.colorScheme;
  const map: Record<string, string | undefined> = {
    "--bg": p.bg_color,
    "--surface": p.secondary_bg_color,
    "--ink": p.text_color,
    "--muted": p.hint_color,
    "--accent": p.button_color,
    "--on-accent": p.button_text_color,
  };
  for (const [k, v] of Object.entries(map)) if (v) root.style.setProperty(k, v);
}

const haptic = (kind: "tap" | "ok" | "warn") => {
  const h = tg?.HapticFeedback;
  if (!h) return;
  if (kind === "tap") h.impactOccurred("light");
  else h.notificationOccurred(kind === "ok" ? "success" : "warning");
};

// ---------------------------------------------------------------- ui bits

let toastTimer = 0;
function toast(text: string) {
  const el = $("[data-toast]");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 1800);
}

async function copy(text: string, what: string, then = "") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "offscreen";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  haptic("ok");
  toast(`${what} copied${then}`);
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** An icon from the sprite in index.html. */
function icon(name: string) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "ico");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------- wallet card

// The session's wallets, so a swipe right can go back to the one before.
const history: Wallet[] = [];
let at = -1;
const current = () => history[at];

function render(w: Wallet) {
  $("[data-stamp]").textContent = stamp(w.createdAt);

  const words = $("[data-words]");
  words.replaceChildren(...w.phrase.split(" ").map((word) => el("li", "", word)));

  const list = $("[data-addresses]");
  // Favourites saved before a chain was added carry no address for it.
  if (CHAINS.some((c) => !w.addresses[c.id])) addressesOf(w.phrase).then((a) => { w.addresses = { ...a, ...w.addresses }; if (current() === w) render(w); });
  list.replaceChildren(...CHAINS.map((c) => addrRow(c.id, chainName(c.id, w), w.addresses[c.id] ?? "…")));
  renderTrust(w);
  syncStar();
}

/** The row's name. TON opens in a different wallet depending on the phrase's length. */
function chainName(id: Chain, w: Wallet): string {
  const c = CHAINS.find((c) => c.id === id)!;
  return id === "TON" ? `${c.name} · ${TON_SCHEME[wordCount(w.phrase)].wallets.split(",")[0]}` : c.name;
}

/** Every address on the card, one "Name: address" per line, Trust Wallet's
 *  own ones last — what a reader pastes into notes or a spreadsheet. */
async function copyAll() {
  const w = current();
  if (!w) return;
  const full = CHAINS.every((c) => w.addresses[c.id]) ? w.addresses : (w.addresses = { ...(await addressesOf(w.phrase)), ...w.addresses });
  const trust = w.trust ?? (w.trust = await trustAddressesOf(w.phrase));
  const lines = CHAINS.map((c) => `${chainName(c.id, w)}: ${full[c.id]}`);
  for (const id of ["SOL", "TON"] as const)
    if (trust[id] !== full[id]) lines.push(`${CHAINS.find((c) => c.id === id)!.name.replace(/ \(.*/, "")} · Trust Wallet: ${trust[id]}`);
  copy(lines.join("\n") + "\n", "All addresses");
}

let qrNow = { name: "", address: "" };

/** The address as a QR code in the page's dialog. Always dark on light, in
 *  both themes: scanners read that polarity. */
function showQr(name: string, address: string) {
  const qr = qrcode(0, "M");
  qr.addData(address);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const side = n + quiet * 2;
  const foot = 5; // room under the code for the site's name, close to it
  svg.setAttribute("viewBox", `0 0 ${side} ${side - quiet + foot}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `QR code of the ${name} address`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  const label = document.createElementNS(NS, "text");
  label.setAttribute("x", String(side / 2));
  label.setAttribute("y", String(side - quiet + foot - 1.4));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-family", "Helvetica, Arial, sans-serif");
  label.setAttribute("font-weight", "700");
  label.setAttribute("font-size", "3");
  label.setAttribute("fill", "#000");
  label.textContent = "seedgen.uk";
  svg.append(bg, path, label);
  $("[data-qr-title]").textContent = `${name} address`;
  $("[data-qr-code]").replaceChildren(svg);
  const line = $("[data-qr-address]");
  line.textContent = address;
  qrNow = { name, address };
  ($("[data-qr]") as HTMLDialogElement).showModal();
  // One line whatever the length: shrink the type until it fits.
  line.style.fontSize = "";
  const fit = line.clientWidth / line.scrollWidth;
  if (fit < 1) line.style.fontSize = `${Math.max(0.3, 0.8 * fit)}rem`;
}

// ChangeNOW's tickers. Its page takes the pair from the URL but no
// recipient (an unknown parameter resets the form), so Exchange copies the
// address for the reader to paste there; nothing is sent with the link.
const CHANGENOW: Record<Chain, string> = {
  SOL: "sol", ETH: "eth", BTC: "btc", BNB: "bnbbsc", XRP: "xrp", TRX: "trx", ZEC: "zec", DOGE: "doge", TON: "ton", XMR: "xmr",
};
const exchangeUrl = (id: Chain) => `https://changenow.io/exchange?from=${id === "BTC" ? "eth" : "btc"}&to=${CHANGENOW[id]}`;

function addrRow(id: Chain, name: string, address: string) {
  const li = el("li", "addr-item");
  const btn = el("button", "addr");
  btn.type = "button";
  btn.title = `Copy ${name} address`;
  btn.append(el("span", `chip chip-${id.toLowerCase()}`, id), el("span", "addr-name", name), el("code", "addr-value", address), icon("copy"));
  btn.addEventListener("click", () => copy(address, `${name} address`));
  const qr = el("button", "qr-btn");
  qr.type = "button";
  qr.title = `Show ${name} address as a QR code`;
  qr.append(icon("qr"), el("span", "visually-hidden", `QR code, ${name}`));
  qr.disabled = address === "…";
  qr.addEventListener("click", () => showQr(name, address));
  const ex = el("a", "qr-btn ex-btn");
  ex.href = exchangeUrl(id);
  ex.target = "_blank";
  ex.rel = "noopener noreferrer";
  ex.title = `Exchange to ${name} on ChangeNOW; the address is copied to paste as the recipient`;
  ex.append(icon("swap"), el("span", "visually-hidden", `Exchange to ${name} on ChangeNOW`));
  ex.addEventListener("click", (e) => {
    if (address === "…") return void e.preventDefault();
    copy(address, `${name} address`, " — paste it on ChangeNOW as the recipient");
    // Inside Telegram an outside link opens in its browser, not over the app.
    if (tg?.openLink) {
      e.preventDefault();
      tg.openLink(ex.href);
    }
  });
  const tools = el("div", "addr-tools");
  tools.append(qr, ex);
  li.append(btn, tools);
  return li;
}

// What the same words show in Trust Wallet. Only the chains where it
// differs from the rows above get a row of their own; the line above them
// names the ones that match, so nobody hunts for a missing balance.
async function renderTrust(w: Wallet) {
  // Favourites saved before this existed carry no Trust addresses.
  const trust = w.trust ?? (w.trust = await trustAddressesOf(w.phrase));
  if (current() !== w) return;
  const differs = (["SOL", "TON"] as const).filter((id) => trust[id] !== w.addresses[id]);
  const same = CHAINS.filter((c) => c.id !== "XMR" && !differs.includes(c.id as "SOL" | "TON")).map((c) => c.name.replace(/ \(.*/, ""));
  const list = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  $("[data-trust-text]").textContent =
    `${list(same)} are the same as above. Trust Wallet takes ${differs.length > 1 ? "Solana and TON from its own paths" : "Solana from its own path"}:`;
  $("[data-trust-list]").replaceChildren(
    ...differs.map((id) => addrRow(id, `${CHAINS.find((c) => c.id === id)!.name.replace(/ \(.*/, "")} · Trust Wallet`, trust[id])),
  );
}

function syncStar() {
  const w = current();
  const on = !!w && isFav(w);
  const star = $("[data-star]");
  star.setAttribute("aria-pressed", String(on));
  const label = on ? "Remove from favourites" : "Add to favourites";
  star.title = label;
  star.querySelector(".visually-hidden")!.textContent = label;
}

let busy = false;
async function generate() {
  if (busy) return;
  busy = true;
  const btn = $<HTMLButtonElement>("[data-generate]");
  btn.disabled = true;
  const label = btn.querySelector("[data-label]")!;
  label.textContent = "Generating…";
  try {
    const w = await newWallet(words);
    history.splice(at + 1);
    history.push(w);
    at = history.length - 1;
    render(w);
    haptic("tap");
  } catch (e) {
    toast("Could not generate — this browser lacks Web Crypto");
    console.error(e);
  } finally {
    busy = false;
    btn.disabled = false;
    label.textContent = "Generate";
  }
}

function setWords(n: WordCount) {
  document.querySelectorAll<HTMLElement>("[data-words-count]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.wordsCount) === n)));
  if (n === words) return;
  words = n;
  try {
    localStorage.setItem(WORDS, String(n));
  } catch {}
  generate();
}

function back() {
  if (at <= 0) return void toast("This is the first one");
  at--;
  render(current());
  haptic("tap");
}

function toggleFav() {
  const w = current();
  if (!w) return;
  favs = isFav(w) ? favs.filter((f) => f.id !== w.id) : [w, ...favs];
  if (saveFavs(favs)) toast(isFav(w) ? "Added to favourites" : "Removed from favourites");
  haptic("tap");
  syncStar();
  renderFavs();
}

// Swipes anywhere on the page. Left for a new wallet, right for the last: the card
// follows the finger and tilts with it, a hint fades in as the drag nears
// the threshold, and on release it either springs back or flies off the
// way it was thrown while the next card rises from under it — a copy of
// the old card does the flying, so the real one can take the new wallet
// at once. Up, from the phrase or the card's head, for the favourites:
// the card lifts with the finger, and on release a star flies from it to
// the Favourites tab. Up from the addresses stays a scroll (touch-action).
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const SWIPE_AT = 90; // px of drag that commits
const LIFT_AT = 80; // px of upward drag that commits
const FLICK = 0.5; // px/ms that commits a shorter drag

/** A star that flies from the card to the Favourites tab, which then pulses. */
function starFlight(card: HTMLElement) {
  const tab = $("[data-view=\"fav\"]");
  if (reducedMotion()) return;
  const from = card.getBoundingClientRect();
  const to = tab.getBoundingClientRect();
  const star = el("span", "star-fly");
  star.append(icon("star"));
  star.setAttribute("aria-hidden", "true");
  const x0 = from.left + from.width / 2, y0 = from.top + 60;
  const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
  Object.assign(star.style, { left: `${x0}px`, top: `${y0}px` });
  document.body.append(star);
  star.animate(
    [
      { transform: "translate(-50%, -50%) scale(.6)", opacity: 0, offset: 0 },
      { transform: "translate(-50%, -50%) scale(1.6)", opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${(x1 - x0) * 0.6}px), calc(-50% + ${(y1 - y0) * 0.35}px)) scale(1.2)`, opacity: 1, offset: 0.65 },
      { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.4)`, opacity: 0.2, offset: 1 },
    ],
    { duration: 620, easing: "cubic-bezier(.4, 0, .6, 1)" },
  ).finished.finally(() => {
    star.remove();
    tab.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
  });
}

function swipe(card: HTMLElement) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, t0 = 0, tracking = false, horizontal: boolean | null = null, liftable = false;

  const place = (x: number) => {
    // Nothing to go back to: the card resists a drag to the right.
    const resisted = x > 0 && at <= 0 ? x * 0.3 : x;
    card.style.transform = `translateX(${resisted}px) rotate(${resisted / 22}deg)`;
    card.style.setProperty("--swipe", String(Math.max(-1, Math.min(1, resisted / SWIPE_AT))));
  };
  const lift = (y: number) => {
    // Downwards is the page's scroll; only the way up lifts the card.
    const up = Math.min(0, y);
    const p = Math.min(1, -up / LIFT_AT);
    card.style.transform = `translateY(${up * 0.5}px) scale(${1 - p * 0.03})`;
    card.style.setProperty("--lift", String(p));
  };
  const settle = () => {
    card.style.setProperty("--swipe", "0");
    card.style.setProperty("--lift", "0");
    if (reducedMotion()) return void (card.style.transform = "");
    const from = card.style.transform;
    card.style.transform = "";
    card.animate([{ transform: from }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.2, 1.4, .4, 1)" });
  };
  const flyOff = (dir: -1 | 1, from: string) => {
    card.style.transform = "";
    card.style.setProperty("--swipe", "0");
    if (reducedMotion()) return;
    const box = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-wallet");
    ghost.setAttribute("aria-hidden", "true");
    ghost.className = "wallet wallet-ghost";
    Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, transform: from });
    ghost.style.setProperty("--swipe", String(dir));
    document.body.append(ghost);
    const to = `translateX(${dir * (window.innerWidth + box.width)}px) rotate(${dir * 28}deg)`;
    ghost.animate([{ transform: from, opacity: 1 }, { transform: to, opacity: 0.4 }], { duration: 380, easing: "cubic-bezier(.3, 0, .8, .5)" }).finished
      .finally(() => ghost.remove());
    // The real card rises from under the thrown one.
    card.animate(
      [{ transform: `translateX(${-dir * 28}px) scale(.94)`, opacity: 0.55 }, { transform: "none", opacity: 1 }],
      { duration: 460, easing: "cubic-bezier(.2, 1.1, .3, 1)" },
    );
  };

  const zone = document.body;
  zone.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || document.documentElement.dataset.view === "fav") return;
    if ((e.target as Element).closest("button, a, dialog, .favs")) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0; t0 = e.timeStamp; tracking = true; horizontal = null;
    liftable = !!(e.target as Element).closest(".words, .wallet-head");
    card.classList.add("dragging");
    try { zone.setPointerCapture(e.pointerId); } catch {}
  });
  zone.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    dx = e.clientX - x0;
    dy = e.clientY - y0;
    if (horizontal === null && Math.hypot(dx, dy) > 8) horizontal = Math.abs(dx) > Math.abs(dy);
    if (horizontal) place(dx);
    else if (horizontal === false && liftable) lift(dy);
  });
  const end = (e: PointerEvent) => {
    if (!tracking) return;
    tracking = false;
    card.classList.remove("dragging");
    if (horizontal === false && liftable) {
      const speed = -dy / Math.max(1, e.timeStamp - t0);
      if (dy <= -LIFT_AT || (dy <= -30 && speed >= FLICK)) {
        const w = current();
        if (w && !isFav(w)) starFlight(card);
        toggleFav();
        haptic("ok");
      }
      return settle();
    }
    const speed = Math.abs(dx) / Math.max(1, e.timeStamp - t0);
    const commits = horizontal && (Math.abs(dx) >= SWIPE_AT || (Math.abs(dx) >= 30 && speed >= FLICK));
    if (!commits || (dx > 0 && at <= 0)) return settle();
    flyOff(dx < 0 ? -1 : 1, card.style.transform);
    if (dx < 0) generate();
    else back();
  };
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);
}

// ---------------------------------------------------------------- favourites view

const CONFIRM_MS = 3000;

function renderFavs() {
  const count = $("[data-fav-count]");
  count.textContent = String(favs.length);
  count.hidden = favs.length === 0;
  $("[data-favs-empty]").hidden = favs.length > 0;

  $("[data-favs]").replaceChildren(
    ...favs.map((w) => {
      const li = el("li", "fav");
      const open = el("button", "fav-open");
      open.type = "button";
      open.title = "Open this wallet";
      open.append(el("span", "fav-date", stamp(w.createdAt)), el("code", "fav-addr", `SOL ${short(w.addresses.SOL)}`), el("span", "fav-words", w.phrase.split(" ").slice(0, 3).join(" ") + " …"));
      open.addEventListener("click", () => {
        history.splice(at + 1);
        history.push(w);
        at = history.length - 1;
        render(w);
        show("gen");
      });

      // One tap arms it, the second within three seconds deletes.
      const del = el("button", "fav-del");
      const delLabel = el("span", "", "Delete");
      del.type = "button";
      del.append(icon("trash"), delLabel);
      let timer = 0;
      del.addEventListener("click", () => {
        if (del.dataset.armed) {
          clearTimeout(timer);
          favs = favs.filter((f) => f.id !== w.id);
          saveFavs(favs);
          haptic("warn");
          renderFavs();
          syncStar();
          toast("Deleted");
          return;
        }
        del.dataset.armed = "1";
        delLabel.textContent = "Sure?";
        haptic("tap");
        timer = window.setTimeout(() => {
          delete del.dataset.armed;
          delLabel.textContent = "Delete";
        }, CONFIRM_MS);
      });

      li.append(open, del);
      return li;
    }),
  );
}

// ---------------------------------------------------------------- network notice

function syncNet() {
  const online = navigator.onLine;
  const box = $("[data-net]");
  box.dataset.state = online ? "online" : "offline";
  $("[data-net-title]").textContent = online ? "Works offline" : "You're offline";
  $("[data-net-text]").textContent = online
    ? "Nothing you generate leaves this device. For extra safety, turn on airplane mode before you generate — the app keeps working without a connection."
    : "Nothing can leave this device now. Generate as many as you like — the app works fully offline.";
}

// ---------------------------------------------------------------- views

function show(view: "gen" | "fav") {
  document.querySelectorAll<HTMLElement>("[data-view-panel]").forEach((p) => (p.hidden = p.dataset.viewPanel !== view));
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
    if (t.dataset.view === view) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  document.documentElement.dataset.view = view;
  if (tg) view === "fav" ? tg.BackButton.show() : tg.BackButton.hide();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- start

function start() {
  const row = (...cells: string[]) => {
    const tr = el("tr");
    tr.append(...cells.map((c) => el("td", "", c)));
    return tr;
  };
  $("[data-paths]").replaceChildren(
    ...CHAINS.filter((c) => c.id !== "TON").map((c) => row(c.name, c.path, c.note)),
    row("Solana in Trust Wallet", TRUST_PATHS.SOL, "Trust Wallet"),
    row("TON, 24 words", TON_SCHEME[24].path, `${TON_SCHEME[24].contract} · ${TON_SCHEME[24].wallets}`),
    row("TON in Trust Wallet, 12 or 24 words", TRUST_PATHS.TON, "v4R2 · Trust Wallet"),
  );
  document.querySelectorAll<HTMLElement>("[data-words-count]").forEach((b) =>
    b.addEventListener("click", () => setWords(Number(b.dataset.wordsCount) as WordCount)),
  );
  document.querySelectorAll<HTMLElement>("[data-words-count]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.wordsCount) === words)));

  const qrDialog = $("[data-qr]") as HTMLDialogElement;
  $("[data-qr-close]").addEventListener("click", () => qrDialog.close());
  $("[data-qr-copy]").addEventListener("click", () => copy(qrNow.address, `${qrNow.name} address`));
  $("[data-qr-print]").addEventListener("click", () => {
    const sheet = $("[data-print]");
    sheet.replaceChildren(
      el("h2", "", `${qrNow.name} address`),
      $("[data-qr-code] svg").cloneNode(true) as SVGElement,
      el("code", "", qrNow.address),
    );
    window.print();
  });
  qrDialog.addEventListener("click", (e) => e.target === qrDialog && qrDialog.close());

  $("[data-generate]").addEventListener("click", generate);
  $("[data-star]").addEventListener("click", toggleFav);
  $("[data-copy-phrase]").addEventListener("click", () => current() && copy(current().phrase, "Phrase"));
  $("[data-copy-all]").addEventListener("click", copyAll);
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view as "gen" | "fav")));
  swipe($("[data-wallet]"));

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    if (e.key === "ArrowRight" || e.key === "n") generate();
    if (e.key === "ArrowLeft") back();
  });

  syncNet();
  window.addEventListener("online", syncNet);
  window.addEventListener("offline", syncNet);

  // Inside Telegram an outside link opens in its browser, not over the app.
  document.querySelectorAll<HTMLAnchorElement>("a[data-external]").forEach((a) =>
    a.addEventListener("click", (e) => {
      if (!tg?.openLink) return;
      e.preventDefault();
      tg.openLink(a.href);
    }),
  );

  renderFavs();
  generate();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

if (inTelegram()) loadTelegram().then(start);
else start();
