import { isAddress, parseUnits, formatUnits } from "ethers";
export type Beneficiary = {
  ref: string;
  recipient: string;
  amount: string;
  channel: "xmoney" | "base";
  reviewed: boolean;
};
export type PrivatePlan = {
  version: 1;
  campaignId: string;
  createdAt: string;
  status: "planned-not-paid";
  budget: string;
  cap: string;
  purpose: string;
  entries: (Beneficiary & { salt: string; commitment: string })[];
  publicReport: PublicReport;
};
export type PublicReport = {
  version: 1;
  campaignId: string;
  status: "planned-not-paid";
  currency: "USDC";
  plannedAmount: string;
  recipientCount: number;
  commitmentRoot: string;
  privacy: "No recipient identities or payment claims in this report";
};
const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b as ArrayBuffer), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
const random = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hash(s: string) {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
}
export function amountUnits(value: string) {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(value))
    throw Error("INVALID_PRECISION");
  const n = parseUnits(value, 6);
  if (n <= 0n) throw Error("POSITIVE_AMOUNT_REQUIRED");
  return n;
}
export async function sealGivingPlan(input: {
  budget: string;
  cap: string;
  purpose: string;
  rows: Beneficiary[];
}): Promise<PrivatePlan> {
  if (!["community", "creators", "public-goods"].includes(input.purpose))
    throw Error("INVALID_BACKUP");
  const budget = amountUnits(input.budget),
    cap = amountUnits(input.cap);
  if (!input.rows.length || input.rows.length > 100)
    throw Error("RECIPIENT_COUNT");
  const seen = new Set();
  let total = 0n;
  for (const r of input.rows) {
    if (
      !["base", "xmoney"].includes(r.channel) ||
      typeof r.recipient !== "string"
    )
      throw Error("INVALID_RECIPIENT");
    if (r.reviewed !== true) throw Error("REVIEW_REQUIRED");
    const recipient = r.recipient.trim();
    if (
      r.channel === "base"
        ? !isAddress(recipient)
        : !/^@?[a-z0-9_]{1,15}$/i.test(recipient)
    )
      throw Error("INVALID_RECIPIENT");
    const key = r.channel + ":" + recipient.replace(/^@/, "").toLowerCase();
    if (seen.has(key)) throw Error("DUPLICATE_RECIPIENT");
    seen.add(key);
    const n = amountUnits(r.amount);
    if (n > cap) throw Error("RECIPIENT_CAP_EXCEEDED");
    total += n;
  }
  if (total > budget) throw Error("BUDGET_EXCEEDED");
  const campaignId = random(16),
    entries = [];
  for (const r of input.rows) {
    const salt = random(32),
      ref = random(16);
    const recipient = r.recipient.trim();
    const commitment = await hash(
      JSON.stringify([
        campaignId,
        ref,
        r.channel,
        recipient,
        amountUnits(r.amount).toString(),
        salt,
      ]),
    );
    entries.push({ ...r, recipient, ref, salt, commitment });
  }
  const commitmentRoot = await hash(
    JSON.stringify(entries.map((e) => e.commitment).sort()),
  );
  const publicReport: PublicReport = {
    version: 1,
    campaignId,
    status: "planned-not-paid",
    currency: "USDC",
    plannedAmount: formatUnits(total, 6),
    recipientCount: entries.length,
    commitmentRoot,
    privacy: "No recipient identities or payment claims in this report",
  };
  return {
    version: 1,
    campaignId,
    createdAt: new Date().toISOString(),
    status: "planned-not-paid",
    budget: input.budget,
    cap: input.cap,
    purpose: input.purpose,
    entries,
    publicReport,
  };
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(pass: string, salt: Uint8Array, usage: KeyUsage[]) {
  const raw = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pass),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 310000,
      hash: "SHA-256",
    },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}
export async function encryptGivingPlan(plan: PrivatePlan, pass: string) {
  if (pass.length < 12) throw Error("PASSPHRASE_TOO_SHORT");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("DarkGiving:v1"),
    },
    await key(pass, salt, ["encrypt"]),
    new TextEncoder().encode(JSON.stringify(plan)),
  );
  return {
    format: "dark-giving-encrypted-v1",
    kdf: "PBKDF2-SHA256",
    iterations: 310000,
    cipher: "AES-256-GCM",
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(encrypted)),
  };
}
export async function decryptGivingPlan(
  file: any,
  pass: string,
): Promise<PrivatePlan> {
  if (
    file?.format !== "dark-giving-encrypted-v1" ||
    file.iterations !== 310000 ||
    typeof file.ciphertext !== "string" ||
    file.ciphertext.length > 200000
  )
    throw Error("INVALID_BACKUP");
  const decoded = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unb64(file.iv),
      additionalData: new TextEncoder().encode("DarkGiving:v1"),
    },
    await key(pass, unb64(file.salt), ["decrypt"]),
    unb64(file.ciphertext),
  );
  const p = JSON.parse(new TextDecoder().decode(decoded));
  if (
    p.version !== 1 ||
    p.status !== "planned-not-paid" ||
    !Array.isArray(p.entries) ||
    p.entries.length > 100
  )
    throw Error("INVALID_BACKUP");
  if (
    !/^[a-f0-9]{32}$/.test(p.campaignId) ||
    typeof p.createdAt !== "string" ||
    !Number.isFinite(Date.parse(p.createdAt))
  )
    throw Error("INVALID_BACKUP");
  // Authenticate the plan's structure and commitments too, not only its envelope.
  const checked = await sealGivingPlan({
    budget: p.budget,
    cap: p.cap,
    purpose: p.purpose,
    rows: p.entries,
  });
  const entries: PrivatePlan["entries"] = [];
  const refs = new Set();
  for (const e of p.entries) {
    if (
      !/^[a-f0-9]{64}$/.test(e.salt) ||
      !/^[a-f0-9]{32}$/.test(e.ref) ||
      refs.has(e.ref)
    )
      throw Error("INVALID_BACKUP");
    refs.add(e.ref);
    const commitment = await hash(
      JSON.stringify([
        p.campaignId,
        e.ref,
        e.channel,
        e.recipient.trim(),
        amountUnits(e.amount).toString(),
        e.salt,
      ]),
    );
    if (commitment !== e.commitment) throw Error("INVALID_BACKUP");
    entries.push({
      ref: e.ref,
      recipient: e.recipient.trim(),
      amount: e.amount,
      channel: e.channel,
      reviewed: true,
      salt: e.salt,
      commitment,
    });
  }
  const commitmentRoot = await hash(
    JSON.stringify(entries.map((e) => e.commitment).sort()),
  );
  const publicReport = {
    ...checked.publicReport,
    campaignId: p.campaignId,
    commitmentRoot,
  };
  if (
    !p.publicReport ||
    Object.keys(p.publicReport).length !== Object.keys(publicReport).length ||
    Object.entries(publicReport).some(([k, v]) => p.publicReport[k] !== v)
  )
    throw Error("INVALID_BACKUP");
  return {
    version: 1,
    campaignId: p.campaignId,
    createdAt: p.createdAt,
    status: "planned-not-paid",
    budget: p.budget,
    cap: p.cap,
    purpose: p.purpose,
    entries,
    publicReport,
  };
}
