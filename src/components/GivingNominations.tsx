import { useEffect, useState } from "react";
import { BrowserProvider, formatUnits } from "ethers";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../lib/context";
import { short } from "../lib/chain";

type Nomination = {
  id: string;
  title: string;
  reason: string;
  owner: string;
  receipts: { chainId?: number; token: string; paidCents: string; stage: string }[];
};
const base = "/api/giving/nominations";
async function post(path: string, data: unknown) {
  const res = await fetch(base + "/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw Error(result.error);
  return result;
}
export default function GivingNominations() {
  const { t, account, connect } = useApp(),
    [params, setParams] = useSearchParams();
  const owner = params.get("owner") || "";
  const [paidCount, setPaidCount] = useState(0);
  const id = params.get("case"),
    before = params.get("before") || "0";
  const [items, setItems] = useState<Nomination[]>([]),
    [next, setNext] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"),
    [retry, setRetry] = useState(0);
  const [title, setTitle] = useState(""),
    [reason, setReason] = useState(""),
    [handle, setHandle] = useState(""),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setState("loading");
    setItems([]);
    setNext(null);
    fetch(
      base +
        (id
          ? "/" + encodeURIComponent(id)
          : "?before=" +
            encodeURIComponent(before) +
            "&owner=" +
            encodeURIComponent(owner)),
      { signal: abort.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw Error();
        return res.json();
      })
      .then((data) => {
        if (!abort.signal.aborted) {
          setItems(id ? [data] : data.items);
          setNext(id ? null : data.next);
          setPaidCount(data.paidBeneficiaries ?? 0);
          setState("ready");
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error");
      });
    return () => abort.abort();
  }, [id, before, owner, retry]);
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !account) return;
    setBusy(true);
    setError("");
    try {
      const proof = await post("challenge", {
        address: account,
        title,
        reason,
        recipient: handle,
        confirmed: consent,
      });
      const signer = await new BrowserProvider(window.ethereum).getSigner(
        account,
      );
      const signature = await signer.signMessage(proof.message);
      const result = await post("publish", { id: proof.id, signature });
      setTitle("");
      setReason("");
      setHandle("");
      setConsent(false);
      setParams({ view: "nominations", case: result.id });
    } catch (e: any) {
      setError(e.code === "ACTION_REJECTED" ? "CANCELLED" : String(e.message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="giving-routes nom-board">
      <h2>{t("Community nominations", "社区公益提名")}</h2>
      {(id || owner) && (
        <Link to="/app/impact?view=nominations">
          {t("All nominations", "全部提名")}
        </Link>
      )}
      {owner && state === "ready" && (
        <p>
          {t("Public record for", "提名人公开记录")} {short(owner)} ·{" "}
          {t("Beneficiaries with verified payments", "已有核验付款的受益人")}{" "}
          {paidCount}
        </p>
      )}
      {state === "loading" && (
        <p role="status">{t("Loading nominations…", "正在读取提名…")}</p>
      )}
      {state === "error" && (
        <p role="status">
          {t("Could not load these nominations.", "暂时无法读取提名。")}{" "}
          <button onClick={() => setRetry((v) => v + 1)}>
            {t("Retry", "重试")}
          </button>
        </p>
      )}
      {state === "ready" && items.length === 0 && (
        <p>{t("No nominations on this page yet.", "本页还没有公益提名。")}</p>
      )}
      {items.map((n) => (
        <article key={n.id}>
          <h3>
            <Link to={"/app/impact?view=nominations&case=" + n.id}>
              {n.title}
            </Link>
          </h3>
          <p>{n.reason}</p>
          <small>
            {t("Nominated by an Agent ID holder", "Agent ID 持有人提名")} ·{" "}
            <Link
              title={n.owner}
              to={"/app/impact?view=nominations&owner=" + n.owner}
            >
              {short(n.owner)}
            </Link>
          </small>
          {n.receipts.length === 0 ? (
            <p>
              {t("Awaiting confirmed trading fees.", "等待可核验的交易税。")}
            </p>
          ) : (
            n.receipts.map((r) => (
              <p key={(r.chainId || 56) + ":" + r.token}>
                <Link to={"/app/impact?view=track&chain=" + (r.chainId === 8453 ? "base" : "bsc") + "&token=" + r.token}>
                  {r.chainId === 8453 ? "Base" : "BSC"} · {short(r.token)}
                </Link>{" "}
                ·{" "}
                {BigInt(r.paidCents) > 0n
                  ? t("Verified payments", "已核验付款") +
                    " $" +
                    formatUnits(r.paidCents, 2)
                  : r.stage === "collecting"
                    ? t("Collecting tax", "税收归集中")
                    : t("Payment in progress", "付款处理中")}
              </p>
            ))
          )}
          <Link
            className="button"
            to={"/app/launch?route=x&nomination=" + n.id}
          >
            {t("Support with launch fees", "用发行税支持")}
          </Link>
        </article>
      ))}
      {next && (
        <Link
          to={
            "/app/impact?view=nominations&before=" +
            next +
            (owner ? "&owner=" + encodeURIComponent(owner) : "")
          }
        >
          {t("Older nominations", "更早的提名")}
        </Link>
      )}
      {!id && !owner && (
        <details>
          <summary>{t("Nominate a beneficiary", "提名受益人")}</summary>
          <p>
            {t(
              "Your title, reason and nominating wallet will be public. Only the verification and payout services receive the X handle.",
              "标题、提名理由和提名钱包地址会公开。受益人的 X 用户名仅用于身份核验与付款。",
            )}
          </p>
          {!account ? (
            <button className="button" onClick={() => void connect()}>
              {t("Connect Agent ID wallet", "连接 Agent ID 钱包")}
            </button>
          ) : (
            <form onSubmit={publish}>
              <fieldset disabled={busy}>
                <label>
                  {t("Public title", "公开标题")}
                  <input
                    maxLength={80}
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  {t("Public reason", "公开提名理由")}
                  <textarea
                    maxLength={320}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  {t("Private X username", "受益人的 X 用户名（私密）")}
                  <input
                    required
                    pattern="@?[a-zA-Z0-9_]{1,15}"
                    autoComplete="off"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                  />
                </label>
                <label className="nom-consent">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {t(
                    "I have confirmed this person can receive X Money. Verify the account and use it for payouts.",
                    "我已确认对方可接收 X Money，同意核验此账号并用于付款。",
                  )}
                </label>
                <button className="button" type="submit">
                  {busy
                    ? t(
                        "Checking signature and identity…",
                        "正在核验签名与身份…",
                      )
                    : t("Sign and publish nomination", "签名并发布提名")}
                </button>
              </fieldset>
            </form>
          )}
          {error && (
            <p role="alert">
              {error === "AGENT_ID_REQUIRED"
                ? t(
                    "This wallet needs a Binance Agent ID to nominate.",
                    "提名钱包须持有币安 Agent ID。",
                  )
                : error === "INVALID_NOMINATION"
                  ? t(
                      "Check the private handle and remove handles or X links from the public text.",
                      "请检查私密用户名，并从公开文字中移除用户名和 X 链接。",
                    )
                  : error === "CANCELLED"
                    ? t("Signature cancelled.", "已取消签名。")
                    : t(
                        "Nomination could not be confirmed. Check the X account and try again.",
                        "提名核验未完成，请检查 X 账号后重试。",
                      )}
            </p>
          )}
        </details>
      )}
    </section>
  );
}
