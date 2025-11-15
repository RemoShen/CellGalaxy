// =============================
// api.js - centralized API helpers
// =============================
/* eslint-disable no-console */

export const API_BASE =
  typeof window !== "undefined" &&
  window.location &&
  window.location.port === "3000"
    ? "http://localhost:8000"
    : "";

export function staticAtlasURL(channel, tile, chunkId) {
  return `${API_BASE}/public/cache/ch${channel}/tile_${tile}/chunk_${chunkId}.png`;
}

export async function fetchJSON(url, { signal, method = "GET", headers, body, cache = "no-store" } = {}) {
  const res = await fetch(url, { signal, method, headers, body, cache });
  if (!res.ok) {
    const text = await safeReadText(res);
    const err = new Error(`HTTP ${res.status} ${res.statusText} ${text ? "- " + text : ""}`);
    err.status = res.status;
    err.statusText = res.statusText;
    throw err;
  }
  return res.json();
}

export async function fetchMeta(signal) {
  try {
    return await fetchJSON(`${API_BASE}/meta`, { signal });
  } catch (e) {
    console.error("fetchMeta failed", e);
    return { error: "Failed to fetch meta" };
  }
}

export async function fetchCoords(signal) {
  try {
    const url = `${API_BASE}/public/coords.json?ts=${Date.now()}`;
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn("fetchCoords failed", e);
    return [];
  }
}

export async function fetchUV(chunkId, tile, signal) {
  return fetchJSON(`${API_BASE}/atlas_uv/${chunkId}?tile=${tile}`, { signal });
}

export async function headStaticAtlas(url, signal) {
  try {
    const res = await fetch(url, { method: "HEAD", signal });
    return res.ok || res.status === 304;
  } catch (e) {
    return false;
  }
}

export async function generateAtlasGrayGet(chunkId, channel, tile, signal) {
  return fetch(`${API_BASE}/atlas/${chunkId}?channel=${channel}&tile=${tile}`, {
    method: "GET",
    signal,
  });
}

export async function generateAtlasGrayPost(chunkId, channel, tile, signal) {
  return fetch(`${API_BASE}/atlas/${chunkId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channels: [channel], tile }),
    signal,
  });
}

export function prewarm(channel, tile) {
  try {
    fetch(`${API_BASE}/prewarm?channel=${channel}&tile=${tile}`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}


