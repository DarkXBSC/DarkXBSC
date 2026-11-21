import { useEffect, useRef, useState } from "react";
import { BrowserProvider, getAddress, isAddress } from "ethers";
import { deviceIdentity } from "../lib/agent-directory";
import { X } from "lucide-react";
import { useApp } from "../lib/context";
import { api, errors, registration, type TxResult } from "../lib/hire";
type Request = {
  id: string;
  data: {
    domain: Record<string, any>;
    types: Record<string, { name: string; type: string }[]>;
    message: Record<string, any>;
  };
};
export default function HireSignature<R = TxResult>({
  allowDevice = false,
  payload,
  onClose,
  onDone,
}: {
  allowDevice?: boolean;
  payload: Record<string, unknown>;
  onClose: () => void;
  onDone: (r: R) => void;
}) {
  const { t, account, signer } = useApp(),
    dialog = useRef<HTMLDialogElement>(null);
  const [external, setExternal] = useState(false),
    [addr, setAddr] = useState(account || ""),
    [request, setRequest] = useState<Request | null>(null),
    [signature, setSignature] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const guarded = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errors(e, t));
    } finally {
      setBusy(false);
    }
  };
  const challenge = (address: string) =>
    api<Request>("challenge", { ...payload, address });
  async function finish(r: Request, sig: string) {
    onDone(await api<R>("commit", { id: r.id, signature: sig }));
  }
  async function device() {
    const key = await deviceIdentity(true);
    if (!key) throw Error("HIRE_SIGNATURE");
    const request = await api<{ id: string; message: string; scheme: string }>(
      "challenge",
      { ...payload, address: key.address },
    );
    if (request.scheme !== "ed25519") throw Error("HIRE_SIGNATURE");
    const intent = JSON.parse(request.message);
    if (
      intent.origin !== location.origin ||
      intent.signer !== key.address ||
      intent.action !== payload.kind ||
      intent.nonce !== request.id
    )
      throw Error("HIRE_SIGNATURE");
    onDone(
      await api<R>("commit", {
        id: request.id,
        signature: await key.sign(request.message),
      }),
    );
  }
  async function browser() {
    if (!window.ethereum) {
      setExternal(true);
      return;
    }
    const wallet = account
      ? await signer("bsc")
      : await (async () => {
          const provider = window.ethereum!;
          await provider.request({ method: "eth_requestAccounts" });
          if (Number(await provider.request({ method: "eth_chainId" })) !== 56)
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x38" }],
            });
          return new BrowserProvider(provider as any).getSigner();
        })();
    const r = await challenge(await wallet.getAddress());
    const { EIP712Domain: _, ...types } = r.data.types;
    await finish(
      r,
      await wallet.signTypedData(r.data.domain, types, r.data.message),
    );
  }
  function signatureValue(raw: string) {
    let s = raw.trim();
    if (s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s),
          o = parsed.data || parsed;
        if (typeof o.signature !== "string") throw Error();
        s = o.signature.replace(/^0x/i, "");
        if (s.length === 128) {
          let v = String(o.signatureRecovery ?? "").replace(/^0x/i, "");
          if (!/^(?:[01]|0[01]|1[bBcC]|27|28)$/.test(v)) throw Error();
          if (v === "27") v = "1b";
          if (v === "28") v = "1c";
          s += v.padStart(2, "0");
        }
      } catch {
        throw Error("HIRE_INPUT");
      }
    }
    s = s.replace(/^0x/i, "");
    if (!/^[0-9a-f]{130}$/i.test(s)) throw Error("HIRE_INPUT");
    return "0x" + s;
  }
  const packet = request
    ? JSON.stringify({
        method: "eth_signTypedData_v4",
        params: [getAddress(addr), JSON.stringify(request.data)],
      })
    : "";
  return (
    <dialog
      className="hire-dialog hire-ui"
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="hire-section-head">
        <h2>{t("Sign your work", "签名确认")}</h2>
        <button
          aria-label={t("Close", "关闭")}
          className="hire-icon"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <p>
        {t(
          allowDevice
            ? "Choose how to sign this public action."
            : "Sign with your BSC wallet. This message costs no gas.",
          allowDevice
            ? "选择签名方式，确认公开提交。"
            : "用 BSC 钱包签署本次操作，无需 Gas。",
        )}
      </p>
      <div className="hire-proof">
        {String(
          payload.line ||
            payload.serviceTitle ||
            payload.title ||
            (payload.kind === "accept"
              ? t("Accept commission", "接下这份委托")
              : t("Select this caption", "选用此稿")),
        )}
      </div>
      {allowDevice && !external && (
        <>
          <button
            className="hire-btn"
            disabled={busy}
            onClick={() => void guarded(device)}
          >
            {t("Sign on this device", "使用本机密钥签名")}
          </button>
          <small>
            {t(
              "This browser keeps your signing key. Clearing site data removes access through this key.",
              "签名密钥保存在当前浏览器。清除站点数据会失去此密钥的管理权限。",
            )}
          </small>
        </>
      )}
      {!external ? (
        <>
          <button
            className="hire-btn primary"
            disabled={busy}
            onClick={() => void guarded(browser)}
          >
            {busy
              ? t("Waiting for wallet…", "等待钱包…")
              : t("Sign with browser wallet", "用浏览器钱包签名")}
          </button>
          <button className="hire-text" onClick={() => setExternal(true)}>
            {t("Use Binance Agentic Wallet CLI", "使用币安 Agentic Wallet CLI")}
          </button>
        </>
      ) : (
        <>
          <label>
            {t("Agentic Wallet address on BSC", "Agentic Wallet 的 BSC 地址")}
            <input
              value={addr}
              onChange={(e) => {
                setAddr(e.target.value);
                setRequest(null);
                setSignature("");
              }}
              placeholder="0x…"
              readOnly={busy}
            />
          </label>
          <button
            className="hire-btn"
            disabled={busy || !isAddress(addr)}
            onClick={() =>
              void guarded(async () => {
                setRequest(await challenge(getAddress(addr)));
                setSignature("");
              })
            }
          >
            {t("Generate signing request", "生成签名请求")}
          </button>
          {request && (
            <>
              <p>
                {t(
                  "In the Binance App, enable Agentic Wallet developer mode. Save the request as dark-agent-request.json. Preview it with the CLI, review the content and confirm before executing.",
                  "在币安 App 的 Agentic Wallet 设置中启用开发者模式。保存请求文件，在 CLI 预览，核对内容后再确认执行。",
                )}
              </p>
              <button
                className="hire-text"
                onClick={() => {
                  const url = URL.createObjectURL(
                      new Blob([packet], { type: "application/json" }),
                    ),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "dark-agent-request.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {t("Download request JSON", "下载请求 JSON")}
              </button>
              <pre>
                {
                  'baw wallet settings --json\nbaw sign-message preview --binanceChainId 56 --signType EIP712 --message "$(cat dark-agent-request.json)" --json\nbaw sign-message execute --requestId <requestId> --json'
                }
              </pre>
              <label>
                {t(
                  "Signature or completed CLI response",
                  "签名或 CLI 完成后的 JSON 回执",
                )}
                <textarea
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                />
              </label>
              <button
                className="hire-btn primary"
                disabled={!signature.trim() || busy}
                onClick={() =>
                  void guarded(() => finish(request, signatureValue(signature)))
                }
              >
                {t("Verify and publish", "验证并提交")}
              </button>
            </>
          )}
          <button
            className="hire-text"
            disabled={busy}
            onClick={() => {
              setExternal(false);
              setError("");
            }}
          >
            {t("Use browser wallet", "使用浏览器钱包")}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {payload.kind === "submit" && !allowDevice && (
        <a
          className="hire-text"
          href={registration}
          target="_blank"
          rel="noreferrer"
        >
          {t("Register a Binance Agent ID", "注册币安 Agent ID")}
        </a>
      )}
    </dialog>
  );
}
