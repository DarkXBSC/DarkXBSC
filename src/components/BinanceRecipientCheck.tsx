import { useState, useEffect, useRef } from "react";
import { useApp } from "../lib/context";
import { squarePostId } from "../lib/square-route";
import { checkBinanceRecipient, type RecipientCheck } from "../lib/tax-route";

export default function BinanceRecipientCheck({
  value,
  onResult,
  result,
}: {
  value: string;
  result: RecipientCheck | null;
  onResult: (result: RecipientCheck | null) => void;
}) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  useEffect(() => {
    gen.current++;
    setBusy(false);
    return () => {
      gen.current++;
    };
  }, [value]);
  async function check() {
    const n = ++gen.current;
    setBusy(true);
    onResult(null);
    const current = await checkBinanceRecipient(value);
    if (n !== gen.current) return;
    onResult(current);
    setBusy(false);
  }
  const messages: Record<string, [string, string]> = {
    READY: [
      "Binance Pay validated the recipient. Settlement uses BSC USDT.",
      "币安 Pay 已核验收款人。税收以 BSC USDT 归集结算。",
    ],
    MERCHANT_UNAVAILABLE: [
      "Merchant payouts are not configured. Automatic settlement is unavailable.",
      "商户付款尚未配置，当前无法自动结算。",
    ],
    POST_NOT_LINKED: [
      "The post does not have a verified link to a Binance account. Enter the recipient’s exchange UID to continue.",
      "该原帖尚无已核验的收款账户。可改填对方的币安交易所 UID。",
    ],
    POST_AUTHOR_UNVERIFIED: [
      "The official post could not be read or its author could not be verified. Use the recipient’s exchange UID.",
      "无法从官方原帖核验作者。可改填对方的币安交易所 UID。",
    ],
    INVALID_RECIPIENT: [
      "Enter a Binance UID or a full binance.com Square post URL.",
      "请填写交易所 UID 或 binance.com 的完整广场原帖链接。",
    ],
    UID_NOT_VALIDATED: [
      "Binance Pay did not validate that UID. Check it with the recipient.",
      "币安 Pay 未核验通过该 UID，请核对收款账号。",
    ],
    MERCHANT_CHECK_FAILED: [
      "The merchant check is unavailable. Retry before launch.",
      "商户核验服务暂不可用，请在发行前重试。",
    ],
  };
  const post = squarePostId(value.trim());
  const copy =
    result && (messages[result.state] || messages.MERCHANT_CHECK_FAILED);
  return (
    <div className="recipient-check">
      <button
        type="button"
        className="button"
        onClick={() => void check()}
        disabled={busy || !value.trim()}
      >
        {busy
          ? t("Checking…", "正在核对…")
          : t("Check automatic payout", "检查能否自动付款")}
      </button>
      {copy && (
        <p role="status">
          {result?.profile && (
            <>
              <a target="_blank" rel="noreferrer" href={result.profile}>
                {result.profile.split("/").pop()}
              </a>{" "}
              ·{" "}
            </>
          )}
          {t(...copy)}
        </p>
      )}
      {post && result?.state !== "READY" && (
        <a
          target="_blank"
          rel="noreferrer"
          href={"https://www.binance.com/en/square/post/" + post}
        >
          {t("Open original post for manual tipping", "打开官方原帖手动打赏")}
        </a>
      )}
    </div>
  );
}
