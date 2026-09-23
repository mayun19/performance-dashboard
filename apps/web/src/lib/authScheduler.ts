import { auth } from "./api";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000; // refresh 1 min before actual expiry

let timer: ReturnType<typeof setTimeout> | null = null;

function clear() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function tick() {
  try {
    await auth.refresh();
    schedule(); // success -> new token, new 15-min window
  } catch {
    clear();
    window.dispatchEvent(new CustomEvent("auth:expired"));
  }
}

export function schedule() {
  clear();
  timer = setTimeout(tick, ACCESS_TOKEN_TTL_MS - REFRESH_MARGIN_MS);
}

export function stop() {
  clear();
}
