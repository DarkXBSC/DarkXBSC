export const categories = {
  writing: ["Writing", "写作"],
  translation: ["Translation", "翻译"],
  research: ["Research", "调研"],
  data: ["Data", "数据"],
  design: ["Design", "设计"],
  development: ["Development", "开发"],
  other: ["Other", "其他"],
} as const;
export const languages = {
  zh: ["Chinese", "中文"],
  en: ["English", "英文"],
  both: ["Chinese & English", "中英双语"],
  other: ["Other", "其他语言"],
} as const;
export type Service = {
  id: string;
  owner: string;
  version: number;
  active: number;
  handle: string;
  category: keyof typeof categories;
  language: keyof typeof languages;
  agent: string;
  title: string;
  description: string;
  delivery: string;
  eta: string;
  updated: number;
  tool?: "links" | "checklist" | null;
};
export function displayService(
  s: Service,
  t: (en: string, zh: string) => string,
): Service {
  if (!s.tool) return s;
  const localized = (field: string) => {
    const match =
      field.match(/^(.+?) · (.+)$/) || field.match(/^(.+。) ([A-Z].+)$/);
    return match ? t(match[2], match[1]) : field;
  };
  return {
    ...s,
    title: localized(s.title),
    description: localized(s.description),
    delivery: localized(s.delivery),
    eta: localized(s.eta),
  };
}
export const shortKey = (k: string) =>
  k.length > 22
    ? k.slice(0, k.startsWith("ed25519:") ? 15 : 8) + "…" + k.slice(-6)
    : k;
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
function openKeys(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open("dark-service-signatures", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("keys");
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
async function devicePair(create: boolean): Promise<CryptoKeyPair | null> {
  const db = await openKeys();
  try {
    const read = () =>
      new Promise<CryptoKeyPair | null>((resolve, reject) => {
        const q = db.transaction("keys").objectStore("keys").get("provider");
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => reject(q.error);
      });
    const saved = await read();
    if (saved || !create) return saved;
    const generated = (await crypto.subtle.generateKey(
      { name: "Ed25519" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      const q = tx.objectStore("keys").add(generated, "provider");
      q.onerror = (e) => {
        if (q.error?.name === "ConstraintError") e.preventDefault();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    return await read();
  } finally {
    db.close();
  }
}
export async function deviceIdentity(create = false) {
  const pair = await devicePair(create);
  if (!pair) return null;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return {
    address: "ed25519:" + hex(raw),
    sign: async (message: string) =>
      hex(
        await crypto.subtle.sign(
          "Ed25519",
          pair.privateKey,
          new TextEncoder().encode(message),
        ),
      ),
  };
}
