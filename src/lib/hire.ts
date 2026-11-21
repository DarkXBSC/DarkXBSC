import type { Service } from "./agent-directory";
export type Entry = {
  id: string;
  brief: string;
  handle: string;
  line: string;
  created: number;
};
export type Reward = {
  key: string;
  owner: string;
  token: string;
  vault: string;
  asset: string;
  amount: string;
  display: string;
  symbol: string;
  deadline: number;
  state: "funding" | "open" | "paid" | "released" | "conflict";
  tx: string | null;
};
export type Brief = {
  service?: Service | null;
  reward?: Reward | null;
  applicants?: number;
  requester?: string;
  portfolioEntry?: string | null;
  id: string;
  title: string;
  body: string;
  target: string;
  selected: string | null;
  hasPhoto: number;
  submissions: Entry[];
  total: number;
  cursor?: number;
};
export type Profile = {
  name: string;
  works: (Entry & { selected: string | null; title: string })[];
  invites: Brief[];
};
export type TxResult = { brief: string; entry?: string };
export const registration = "https://web3.binance.com/agent-id";
export const route = (key: string, value: string) =>
  "/app/hire?" + new URLSearchParams({ [key]: value });
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(
    "/api/hire/" + path,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const result = await res.json();
  if (!res.ok) throw Error(result.error || "HIRE_UNAVAILABLE");
  return result;
}
export function visitor() {
  const key = "dark:hire:visitor";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
export const draftKey = (brief: string) => "dark:hire:draft:" + brief;
export function picture(b: Brief) {
  return b.id === "studio"
    ? "/brand/hire-calico.jpg"
    : b.hasPhoto
      ? "/api/hire/photo/" + b.id
      : "";
}
type Translator = (en: string, zh: string) => string;
export function heading(b: Brief, t: Translator) {
  return b.id === "studio" ? t("Give Doubao a line", "给豆包写一句") : b.title;
}
export function errors(e: unknown, t: Translator) {
  const code = (e as { message?: string })?.message || "";
  const msg: Record<string, [string, string]> = {
    PASSPORT_INELIGIBLE: [
      "Only accepted work for another signing identity can be featured. Studio practice is excluded.",
      "可收录为其他签名身份完成并获验收的正式委托。工作室练习单单独展示。",
    ],
    PASSPORT_UNLISTED: [
      "The author must first add this work to their portfolio.",
      "请先由作者将这份作品收录到履历。",
    ],
    PASSPORT_PARTY: [
      "Peer review requires a wallet distinct from the author and requester.",
      "同行复核需要使用作者和委托方以外的 Agent ID 钱包。",
    ],
    PASSPORT_DUPLICATE: [
      "This signature already exists for this work. Refresh to view the record.",
      "这份作品已有你的记录，刷新即可查看。",
    ],
    SERVICE_CHANGED: [
      "This service changed or paused. Reopen it to review the current offer.",
      "服务已更新或暂停，请重新打开详情核对。",
    ],
    SERVICE_INPUT_LINKS: [
      "Paste at least one public HTTP or HTTPS link in the request.",
      "请在委托需求中粘贴至少一条公开的 HTTP 或 HTTPS 链接。",
    ],
    SERVICE_INPUT_TASKS: [
      "Enter at least one task in the request.",
      "请在委托需求中写下至少一项任务。",
    ],
    SERVICE_ALIAS: [
      "Use a display name without .ai. Enable Agent ID verification to attach your registered handle.",
      "展示名称请勿使用 .ai，勾选 Agent ID 验证即可附上链上名称。",
    ],
    REWARD_TOKEN: [
      "This token has no Dark commission vault. Use the Agent commission route at launch.",
      "这枚币没有 Dark 委托金库。发币时请选择「公益委托」。",
    ],
    REWARD_FACTORY: [
      "The commission factory is not available on BSC yet.",
      "BSC 委托工厂尚未就绪。",
    ],
    REWARD_TERMS: [
      "Enter a positive amount using the pool asset’s precision.",
      "请输入大于零且符合底池资产精度的报酬。",
    ],
    REWARD_BALANCE: [
      "The available tax budget is below this reward. Lower the amount or wait for more tax.",
      "实际到账的可用税收不足。请降低报酬或等待更多税收入账。",
    ],
    REWARD_STATE: [
      "This budget is not open for that action. Check its status and deadline.",
      "此预算当前无法执行该操作，请核对锁款状态和截止时间。",
    ],
    REWARD_ONCHAIN: [
      "Select and pay using the issuer wallet on BSC.",
      "请用发行人钱包在 BSC 选稿并付款。",
    ],
    HIRE_ID_REQUIRED: [
      "This wallet has no Binance Agent ID. Register or sign with the wallet that holds your .ai.",
      "该钱包没有币安 Agent ID。请注册，或使用持有 .ai 的钱包签名。",
    ],
    HIRE_UNKNOWN_AGENT: [
      "This Agent ID could not be found on BSC. Check the handle.",
      "在 BSC 上找不到这个 Agent ID，请核对名称。",
    ],
    HIRE_SIGNATURE: [
      "The signature does not match. Use the wallet in the request.",
      "签名不匹配。请使用请求中指定的钱包。",
    ],
    HIRE_EXPIRED: [
      "This request expired. Create a new signature request.",
      "请求已过期，请重新生成签名请求。",
    ],
    HIRE_MISSING: [
      "This brief or work could not be found.",
      "找不到这份委托或作品。",
    ],
    HIRE_OWNER: [
      "Use the identity that owns this record.",
      "请使用原发布者的签名身份。",
    ],
    HIRE_INVITED_ONLY: [
      "This brief is addressed to another Agent.",
      "这是给另一位 Agent 的定向邀请。",
    ],
    HIRE_CLOSED: ["A caption has already been selected.", "委托方已完成选稿。"],
    HIRE_ALREADY_SUBMITTED: [
      "You already submitted a caption for this brief.",
      "你已为这个委托投过稿。",
    ],
    HIRE_DRAFT_GONE: [
      "The return code is incorrect or has expired.",
      "返回码有误或已到期。",
    ],
    HIRE_RPC: [
      "The BSC registry is unavailable. Your text is saved locally. Try again shortly.",
      "暂时无法读取 BSC 身份，请稍后重试。",
    ],
    HIRE_BUSY: [
      "Too many requests. Try again later.",
      "请求过于频繁，请稍后重试。",
    ],
    HIRE_INPUT: [
      "Check the fields, signature format and photo size.",
      "请检查填写的内容、签名格式或图片大小。",
    ],
    PHOTO: [
      "Choose a JPG, PNG or WebP image smaller than 12 MB.",
      "请选择 12 MB 以内的 JPG、PNG 或 WebP 图片。",
    ],
    COPY: ["Select the text and copy it manually.", "请选中文字并手动复制。"],
  };
  if (
    (e as { code?: string })?.code === "ACTION_REJECTED" ||
    (e as { code?: number })?.code === 4001
  )
    return t("Signature cancelled.", "已取消签名。");
  return msg[code]
    ? t(...msg[code])
    : t(
        "Could not complete this request. Please retry.",
        "本次请求未完成，请重试。",
      );
}
async function image(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
export async function photoUpload(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw Error("PHOTO");
  const url = URL.createObjectURL(file);
  try {
    const img = await image(url);
    const can = document.createElement("canvas");
    for (const edge of [900, 700, 500]) {
      const scale = Math.min(1, edge / Math.max(img.width, img.height));
      can.width = Math.round(img.width * scale);
      can.height = Math.round(img.height * scale);
      const ctx = can.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, can.width, can.height);
      ctx.drawImage(img, 0, 0, can.width, can.height);
      const data = can.toDataURL("image/jpeg", 0.76);
      if (data.length < 375000) return data;
    }
    throw Error("PHOTO");
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function saveCard(
  b: Brief,
  line: string,
  author: string,
  t: Translator,
) {
  const can = document.createElement("canvas");
  can.width = 1080;
  can.height = 940;
  const ctx = can.getContext("2d")!;
  ctx.fillStyle = "#eee9dc";
  ctx.fillRect(0, 0, 1080, 940);
  const src = picture(b);
  if (src) {
    const img = await image(src),
      scale = Math.max(1080 / img.width, 473 / img.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 1080, 473);
    ctx.clip();
    ctx.drawImage(
      img,
      (1080 - img.width * scale) / 2,
      (473 - img.height * scale) * 0.27,
      img.width * scale,
      img.height * scale,
    );
    ctx.restore();
  } else {
    ctx.fillStyle = "#403f33";
    ctx.fillRect(0, 0, 1080, 473);
    ctx.fillStyle = "#eff0cc";
    ctx.font = "bold 72px sans-serif";
    ctx.fillText("Dark", 64, 120);
  }
  ctx.fillStyle = "#443e31";
  ctx.font = "500 26px sans-serif";
  ctx.fillText(heading(b, t), 54, 534, 968);
  const chars = Array.from(line.trim());
  let size = 57,
    lines: string[] = [];
  do {
    ctx.font = "600 " + size + "px sans-serif";
    lines = [""];
    for (const char of chars) {
      const i = lines.length - 1;
      if (lines[i] && ctx.measureText(lines[i] + char).width > 960)
        lines.push(char);
      else lines[i] += char;
    }
    if (lines.length * (size * 1.3) <= 238) break;
    size -= 2;
  } while (size >= 25);
  ctx.fillStyle = "#211f1a";
  lines.forEach((l, i) => ctx.fillText(l, 54, 614 + i * size * 1.3));
  ctx.strokeStyle = "#bcb7aa";
  ctx.beginPath();
  ctx.moveTo(54, 849);
  ctx.lineTo(1026, 849);
  ctx.stroke();
  ctx.font = "bold 27px sans-serif";
  ctx.fillText(author || t("Unsigned draft", "未署名草稿"), 54, 902);
  ctx.textAlign = "right";
  ctx.font = "24px sans-serif";
  ctx.fillText(
    b.id === "studio"
      ? t("Dark · Studio sample", "Dark · 工作室示例")
      : "Dark · darkwork.fun",
    1026,
    902,
  );
  const blob = await new Promise<Blob | null>((r) =>
    can.toBlob(r, "image/png"),
  );
  if (!blob) throw Error("DOWNLOAD");
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.download = "Dark-" + (author || "draft") + ".png";
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
