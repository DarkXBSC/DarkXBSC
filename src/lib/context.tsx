import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserProvider,
  getAddress,
  TransactionRequest,
  TransactionReceipt,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { Chain, Config, chainInfo, rpc, errorCode, short } from "./chain";
declare global {
  interface Window {
    ethereum?: any;
  }
}
export type Activity = {
  chain: Chain;
  hash: string;
  label: string;
  account: string;
  at: number;
  status: "pending" | "confirmed" | "failed";
};
export type Submission = {
  id: string;
  chain: Chain;
  account: string;
  to: string;
  data: string;
  value: string;
  nonce: number;
  label: string;
  at: number;
  hash: string;
};
type State = {
  config: Config | null;
  configError: boolean;
  refresh: () => Promise<void>;
  zh: boolean;
  t: (en: string, zh: string) => string;
  toggleLang: () => void;
  dark: boolean;
  toggleTheme: () => void;
  account: string;
  walletChain: number | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signer: (chain: Chain) => Promise<any>;
  transact: (
    chain: Chain,
    tx: TransactionRequest,
    label: string,
  ) => Promise<TransactionReceipt>;
  busy: boolean;
  message: string;
  setMessage: (s: string) => void;
  activities: Activity[];
  recover: (a: Activity) => Promise<void>;
  submissions: Submission[];
  reconcile: (intent: Submission, hash: string) => Promise<void>;
};
const C = createContext<State>(null!);
export const useApp = () => useContext(C);
const readList = <T,>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null),
    [configError, setConfigError] = useState(false);
  const [zh, setZh] = useState(
      localStorage.getItem("tiger-genesis:lang") === "zh",
    ),
    [dark, setDark] = useState(
      localStorage.getItem("tiger-genesis:theme") !== "light",
    );
  const [account, setAccount] = useState(""),
    [walletChain, setWalletChain] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [activities, setActivities] = useState<Activity[]>(() => {
    const saved = readList<Activity>("tiger-genesis:activity");
    for (const x of readList<Submission>("tiger-genesis:submissions"))
      if (x.hash && !saved.some((a) => a.hash === x.hash))
        saved.push({
          chain: x.chain,
          hash: x.hash,
          label: x.label,
          account: x.account,
          at: x.at,
          status: "pending",
        });
    return saved;
  });
  const [submissions, setSubmissions] = useState<Submission[]>(() =>
    readList("tiger-genesis:submissions"),
  );
  const locked = useRef(false),
    pendingRef = useRef(submissions);
  const t = (en: string, cn: string) => (zh ? cn : en);
  function savePending(next: Submission[]) {
    localStorage.setItem("tiger-genesis:submissions", JSON.stringify(next));
    pendingRef.current = next;
    setSubmissions(next);
  }
  function clearPending(id: string) {
    savePending(pendingRef.current.filter((x) => x.id !== id));
  }
  function record(activity: Activity) {
    setActivities((old) => {
      const next = [
        activity,
        ...old.filter((x) => x.hash !== activity.hash),
      ].slice(0, 100);
      localStorage.setItem("tiger-genesis:activity", JSON.stringify(next));
      return next;
    });
  }
  async function refresh() {
    try {
      const r = await fetch("/api/config");
      if (!r.ok) throw Error();
      setConfig(await r.json());
      setConfigError(false);
    } catch {
      setConfigError(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("tiger-genesis:theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    localStorage.setItem("tiger-genesis:lang", zh ? "zh" : "en");
  }, [zh]);
  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const changed = (accounts: string[]) => {
      setAccount(accounts[0] ? getAddress(accounts[0]) : "");
      setMessage("");
    };
    const chain = (id: string) => setWalletChain(Number(id));
    p.on?.("accountsChanged", changed);
    p.on?.("chainChanged", chain);
    return () => {
      p.removeListener?.("accountsChanged", changed);
      p.removeListener?.("chainChanged", chain);
    };
  }, []);
  async function connect() {
    try {
      if (!window.ethereum) throw Error("WALLET_NOT_FOUND");
      const a = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!a[0]) throw Error("CONNECT_WALLET");
      setAccount(getAddress(a[0]));
      setWalletChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
      setMessage("");
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  async function signer(chain: Chain) {
    if (!window.ethereum || !account) throw Error("CONNECT_WALLET");
    const p = window.ethereum,
      id = chainInfo[chain].id;
    if (Number(await p.request({ method: "eth_chainId" })) !== id) {
      try {
        await p.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + id.toString(16) }],
        });
      } catch (e: any) {
        if (e.code !== 4902) throw e;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x" + id.toString(16),
              chainName: chainInfo[chain].name,
              nativeCurrency: {
                name: chainInfo[chain].symbol,
                symbol: chainInfo[chain].symbol,
                decimals: 18,
              },
              rpcUrls: [config!.chains[chain].rpc],
              blockExplorerUrls: [chainInfo[chain].explorer],
            },
          ],
        });
      }
    }
    const b = new BrowserProvider(p),
      s = await b.getSigner();
    if (
      (await s.getAddress()).toLowerCase() !== account.toLowerCase() ||
      Number((await b.getNetwork()).chainId) !== id
    )
      throw Error("WALLET_CHANGED");
    return s;
  }
  async function transact(chain: Chain, tx: TransactionRequest, label: string) {
    if (locked.current) throw Error("TRANSACTION_PENDING");
    if (
      pendingRef.current.some(
        (x) =>
          x.chain === chain &&
          x.account.toLowerCase() === account.toLowerCase(),
      )
    )
      throw Error("RECOVER_PREVIOUS_TRANSACTION");
    locked.current = true;
    setBusy(true);
    setMessage(t("Simulating transaction…", "正在模拟交易…"));
    let hash = "",
      intent: Submission | undefined;
    try {
      const s = await signer(chain),
        from = await s.getAddress(),
        request = { ...tx, from };
      await s.provider.call(request);
      const gas = await s.estimateGas(request),
        nonce = await s.getNonce("pending");
      intent = {
        id: keccak256(
          toUtf8Bytes(
            JSON.stringify([
              chain,
              from,
              nonce,
              tx.to,
              tx.data,
              String(tx.value || 0),
            ]),
          ),
        ),
        chain,
        account: from,
        to: String(tx.to),
        data: String(tx.data || "0x"),
        value: String(tx.value || 0),
        nonce,
        label,
        at: Date.now(),
        hash: "",
      };
      // Persist before handing control to the wallet; an interrupted response must be reconciled, never resubmitted.
      savePending([...pendingRef.current, intent]);
      setMessage(
        t("Confirm the transaction in your wallet.", "请在钱包中确认交易。"),
      );
      const response = await s.sendTransaction({
        ...request,
        nonce,
        gasLimit: (gas * 120n) / 100n,
      });
      hash = response.hash;
      intent = { ...intent, hash };
      savePending(
        pendingRef.current.map((x) => (x.id === intent!.id ? intent! : x)),
      );
      const activity: Activity = {
        chain,
        hash,
        label,
        account: from,
        at: intent.at,
        status: "pending",
      };
      record(activity);
      setMessage(
        t("Submitted. Waiting for confirmations…", "已提交，等待链上确认…"),
      );
      const receipt = await rpc(chain).waitForTransaction(hash, 2, 90000);
      if (!receipt) throw Error("RECEIPT_PENDING");
      record({
        ...activity,
        status: receipt.status === 1 ? "confirmed" : "failed",
      });
      clearPending(intent.id);
      if (receipt.status !== 1) throw Error("TRANSACTION_REVERTED");
      setMessage(t("Confirmed: ", "交易已确认：") + short(hash));
      return receipt;
    } catch (e) {
      const code = errorCode(e),
        definitelyNotSent =
          !hash && ["REJECTED", "INSUFFICIENT_FUNDS"].includes(code);
      if (intent && definitelyNotSent) clearPending(intent.id);
      setMessage(code + (hash ? " · " + short(hash) : ""));
      if (e && typeof e === "object")
        Object.assign(e, {
          submitted:
            !!intent && pendingRef.current.some((x) => x.id === intent!.id),
        });
      throw e;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function recover(a: Activity) {
    try {
      const r = await rpc(a.chain).getTransactionReceipt(a.hash);
      if (!r || (await r.confirmations()) < 2) {
        setMessage("RECEIPT_PENDING");
        return;
      }
      record({ ...a, status: r.status === 1 ? "confirmed" : "failed" });
      const item = pendingRef.current.find((x) => x.hash === a.hash);
      if (item) clearPending(item.id);
      setMessage(t("Receipt refreshed.", "回执已更新。"));
    } catch {
      setMessage("RPC_UNAVAILABLE");
    }
  }
  async function reconcile(intent: Submission, hash: string) {
    try {
      if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw Error("INVALID_HASH");
      const p = rpc(intent.chain),
        tx = await p.getTransaction(hash);
      if (!tx) throw Error("RECEIPT_PENDING");
      if (
        tx.from.toLowerCase() !== intent.account.toLowerCase() ||
        tx.to?.toLowerCase() !== intent.to.toLowerCase() ||
        tx.data !== intent.data ||
        tx.value.toString() !== intent.value ||
        tx.nonce !== intent.nonce
      )
        throw Error("TRANSACTION_MISMATCH");
      savePending(
        pendingRef.current.map((x) =>
          x.id === intent.id ? { ...x, hash } : x,
        ),
      );
      const activity: Activity = {
        chain: intent.chain,
        hash,
        label: intent.label,
        account: intent.account,
        at: intent.at,
        status: "pending",
      };
      record(activity);
      await recover(activity);
    } catch (e) {
      setMessage(errorCode(e));
    }
  }
  return (
    <C.Provider
      value={{
        config,
        configError,
        refresh,
        zh,
        t,
        toggleLang: () => setZh((x) => !x),
        dark,
        toggleTheme: () => setDark((x) => !x),
        account,
        walletChain,
        connect,
        disconnect: () => {
          setAccount("");
          setWalletChain(null);
        },
        signer,
        transact,
        busy,
        message,
        setMessage,
        activities,
        recover,
        submissions,
        reconcile,
      }}
    >
      {children}
    </C.Provider>
  );
}
