import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BrowserProvider, getAddress } from "ethers";
import { squareStatement } from "../lib/square-route";
import { useApp } from "../lib/context";
import { CopyText } from "./Frame";
export default function SquareProof() {
  const { account, connect, t } = useApp(),
    [profile, setProfile] = useState(""),
    [proof, setProof] = useState<{
      address: string;
      profile: string;
      text: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#square-proof" && disclosure.current) {
      disclosure.current.open = true;
      disclosure.current.scrollIntoView({ block: "start" });
    }
  }, [hash]);
  const [post, setPost] = useState(""),
    [published, setPublished] = useState("");
  async function register() {
    const n = ++generation.current;
    setBusy(true);
    setError("");
    setPublished("");
    try {
      const res = await fetch("/api/giving/square-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post, declarationOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) throw Error();
      if (n === generation.current) setPublished(data.address);
    } catch {
      if (n === generation.current)
        setError(
          t(
            "The original declaration and its author could not be verified. Check the published post and try again.",
            "无法核验签名声明及原帖作者，请检查已发布的帖子后重试。",
          ),
        );
    } finally {
      setBusy(false);
    }
  }
  async function sign() {
    setError("");
    if (!account) {
      await connect();
      return;
    }
    setBusy(true);
    const n = ++generation.current;
    try {
      const p = new BrowserProvider(window.ethereum),
        s = await p.getSigner(account);
      const addr = getAddress(await s.getAddress()),
        statement = squareStatement(profile, addr);
      const signature = await s.signMessage(statement);
      if (n === generation.current)
        setProof({
          address: addr,
          profile,
          text: statement + "\nSignature: " + signature,
        });
    } catch {
      setError(
        t(
          "Check the profile URL and approve the message with the receiving wallet.",
          "请核对广场主页链接，并用收款钱包签署声明。",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      id="square-proof"
      className="square-proof"
      ref={disclosure}
    >
      <summary>
        {t("Set up my Square payout post", "创建我的广场收款声明")}
      </summary>
      <p>
        {t(
          "Sign with the BSC wallet that should receive fees. Publish the complete declaration as an original post from your own Square profile, then share that post with issuers.",
          "使用接收税收的 BSC 钱包签名。从自己的广场账号发布完整声明为原创帖，并把帖子链接分享给发行者。",
        )}
      </p>
      <label>
        {t("My Binance Square profile", "我的币安广场主页")}
        <input
          value={profile}
          placeholder="https://www.binance.com/en/square/profile/…"
          onChange={(e) => {
            generation.current++;
            setProfile(e.target.value);
            setProof(null);
            setError("");
          }}
        />
      </label>
      <button
        className="button"
        disabled={busy || !profile}
        onClick={() => void sign()}
      >
        {account
          ? t("Sign payout declaration", "签名收款声明")
          : t("Connect receiving wallet", "连接收款钱包")}
      </button>
      {error && <p role="alert">{error}</p>}
      {proof &&
        proof.address.toLowerCase() === account.toLowerCase() &&
        proof.profile === profile && (
          <>
            <pre>{proof.text}</pre>
            <CopyText value={proof.text} />
          </>
        )}
      <label>
        {t("Register the published declaration", "登记已发布的声明原帖")}
        <input
          placeholder="https://www.binance.com/en/square/post/…"
          value={post}
          onChange={(e) => {
            generation.current++;
            setPost(e.target.value);
            setPublished("");
            setError("");
          }}
        />
      </label>
      <button
        className="button"
        disabled={busy || !post}
        onClick={() => void register()}
      >
        {t("Verify published post", "核验已发布的原帖")}
      </button>
      {published && (
        <p role="status">
          {t("Verified payout wallet", "已核验收款钱包")}{" "}
          <CopyText value={published} />
        </p>
      )}
    </details>
  );
}
