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

async function copy(text: string, what: string) {
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
  toast(`${what} copied`);
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
  // Favourites saved before Monero was added carry no XMR address.
  if (!w.addresses.XMR) addressesOf(w.phrase).then((a) => { w.addresses.XMR = a.XMR; if (current() === w) render(w); });
  list.replaceChildren(
    ...CHAINS.map((c) => {
      // TON opens in a different wallet depending on the phrase's length.
      const name = c.id === "TON" ? `${c.name} · ${TON_SCHEME[wordCount(w.phrase)].wallets.split(",")[0]}` : c.name;
      return addrRow(c.id, name, w.addresses[c.id] ?? "…");
    }),
  );
  renderTrust(w);
  syncStar();
}

function addrRow(id: Chain, name: string, address: string) {
  const li = el("li");
  const btn = el("button", "addr");
  btn.type = "button";
  btn.title = `Copy ${name} address`;
  btn.append(el("span", `chip chip-${id.toLowerCase()}`, id), el("span", "addr-name", name), el("code", "addr-value", address), icon("copy"));
  btn.addEventListener("click", () => copy(address, `${name} address`));
  li.append(btn);
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

// Horizontal swipe on the card: left for a new wallet, right for the last.
function swipe(card: HTMLElement) {
  let x0 = 0, y0 = 0, dx = 0, tracking = false, horizontal: boolean | null = null;
  card.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || (e.target as Element).closest("button")) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; tracking = true; horizontal = null;
  });
  card.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (horizontal === null && Math.hypot(dx, dy) > 8) horizontal = Math.abs(dx) > Math.abs(dy);
    if (horizontal) card.style.transform = `translateX(${dx * 0.6}px) rotate(${dx / 60}deg)`;
  });
  const end = () => {
    if (!tracking) return;
    tracking = false;
    card.style.transform = "";
    if (!horizontal || Math.abs(dx) < 70) return;
    if (dx < 0) generate();
    else back();
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  card.addEventListener("pointerleave", end);
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

  $("[data-generate]").addEventListener("click", generate);
  $("[data-star]").addEventListener("click", toggleFav);
  $("[data-copy-phrase]").addEventListener("click", () => current() && copy(current().phrase, "Phrase"));
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
