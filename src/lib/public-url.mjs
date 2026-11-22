const gateway = "https://flap.mypinata.cloud/ipfs/";
const cidPattern = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[yk][a-z2-7]{20,120})$/;

// Flap metadata returns image CIDs without a URI scheme. Use the same
// normalization in the API and browser, including for previously pinned data.
export function publicUrl(input) {
  if (typeof input !== "string") return "";
  const value = input.trim();
  const path = value.replace(/^ipfs:\/\/(?:ipfs\/)?/, "");
  const [cid, ...parts] = path.split("/");
  if (cidPattern.test(cid)) {
    try {
      if (parts.some((part) => {
        const decoded = decodeURIComponent(part);
        return [".", ".."].includes(decoded) || /[\\/?#\u0000-\u001f]/.test(decoded);
      })) return "";
      return gateway + cid + parts.map((part) => "/" + encodeURIComponent(decodeURIComponent(part))).join("");
    } catch {
      return "";
    }
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
