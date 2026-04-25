/**
 * 在支持 File System Access API 的浏览器（Chromium 系）中，将 OME-TIFF 的
 * FileSystemFileHandle 存入 IndexedDB，刷新后可在授权下再次 getFile()，
 * 无需把整份 TIFF 拷进内存或经后端。
 */

const DB_NAME = "MultiScaleImageProjection";
const DB_VERSION = 1;
const STORE = "kv";
const KEY_HANDLE = "omeTiffFileHandle";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export function supportsOmeTiffHandlePersistence() {
  return (
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function" &&
    typeof indexedDB !== "undefined"
  );
}

export async function saveOmeTiffFileHandle(handle) {
  if (!handle) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(handle, KEY_HANDLE);
  });
}

export async function clearOmeTiffFileHandle() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(KEY_HANDLE);
    });
  } catch {
    /* ignore */
  }
}

export async function getStoredOmeTiffFileHandle() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(KEY_HANDLE);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }
}

/**
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<File|null>}
 */
export async function getFileFromOmeTiffHandle(handle) {
  if (!handle || typeof handle.getFile !== "function") return null;
  const opts = { mode: "read" };
  try {
    if (typeof handle.queryPermission === "function") {
      let state = await handle.queryPermission(opts);
      if (state === "prompt" && typeof handle.requestPermission === "function") {
        state = await handle.requestPermission(opts);
      }
      if (state !== "granted") return null;
    }
    return await handle.getFile();
  } catch {
    return null;
  }
}
