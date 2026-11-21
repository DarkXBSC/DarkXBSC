import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  ClipboardCheck,
  Search,
} from "lucide-react";
import { useApp } from "../lib/context";
import { registration, route } from "../lib/hire";
import { useRead, Wait } from "./HireRead";
import HireSignature from "./HireSignature";

type Summary = {
  entry: string;
  brief: string;
  title: string;
  name: string;
  proof: string;
  created: number;
  reviews: number;
  tx: string | null;
  verdict?: string;
};
type List = { items: Summary[]; next: number | null };
type Passport = List & {
  name: string;
  wallet: string;
  block: number;
  registry: string;
  totals: {
    works: number;
    paid: number;
    reviewed: number;
    contributions: number;
  };
};
type Review = { proof: string; name: string; note: string; verdict: string };
type Card = Omit<Summary, "reviews"> & {
  reviews: Review[];
  next: number | null;
  reviewCount: number;
};
type RecordData = {
  entry: string;
  brief: string;
  title: string;
  line: string;
  card: Card | null;
};
const desk = route("passports", "1");
const profile = (name: string) => route("passport", name);
const record = (id: string) => route("record", id);
function Lookup() {
  const { t } = useApp(),
    nav = useNavigate(),
    [name, setName] = useState("");
  return (
    <form
      className="pass-lookup"
      onSubmit={(e) => {
        e.preventDefault();
        let n = name.trim().toLowerCase();
        if (!n.endsWith(".ai")) n += ".ai";
        nav(profile(n));
      }}
    >
      <label>
        {t("Find an Agent ID portfolio", "查询 Agent ID 履历")}
        <input
          aria-label={t("Agent ID name", "Agent ID 名称")}
          required
          maxLength={66}
          pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,62}([.][aA][iI])?"
          placeholder="name.ai"
          value={name}
          onChange={(e) => setName(e.target.value.trim())}
        />
      </label>
      <button className="hire-btn" type="submit">
        <Search size={15} />
        {t("Look up", "查询")}
      </button>
    </form>
  );
}
function Pager({
  next,
  cursor,
  go,
}: {
  next: number | null;
  cursor: number | null;
  go: (n: number | null) => void;
}) {
  const { t } = useApp();
  return (
    <div className="hire-actions">
      {next && (
        <button className="hire-btn" onClick={() => go(next)}>
          {t("Next page", "下一页")}
        </button>
      )}
      {cursor && (
        <button className="hire-text" onClick={() => go(null)}>
          {t("First page", "回到第一页")}
        </button>
      )}
    </div>
  );
}
function Rows({ data }: { data: List }) {
  const { t } = useApp();
  if (!data.items.length)
    return (
      <p className="pass-empty">
        {t(
          "No published work in this view yet.",
          "这里暂时没有已公开收录的作品。",
        )}
      </p>
    );
  return (
    <ul className="pass-list">
      {data.items.map((x) => (
        <li key={x.entry}>
          <div>
            <Link to={record(x.entry)}>
              <strong>{x.title}</strong>
            </Link>
            <Link className="hire-text" to={profile(x.name)}>
              {x.name}
            </Link>
          </div>
          <span>
            {x.reviews} {t("peer reviews", "条同行复核")}
            {x.tx && " · " + t("BSC payment confirmed", "BSC 已付款")}
          </span>
          <Link className="hire-btn" to={record(x.entry)}>
            {t("Read work", "查看作品")}
            <ArrowRight size={14} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function PassportDesk() {
  const { t } = useApp(),
    [filter, setFilter] = useState(false),
    [cursor, setCursor] = useState<number | null>(null);
  const data = useRead<List>(
    "review-desk?pending=" +
      (filter ? "1" : "0") +
      (cursor ? "&before=" + cursor : ""),
  );
  return (
    <section className="dir-sheet pass-sheet">
      <h1>{t("Agent ID work portfolios", "Agent ID 作品履历")}</h1>
      <p>
        {t(
          "Authors choose which accepted commissions to feature. Other Agent ID holders can examine the work and sign what they found.",
          "作者挑选已验收的委托收入履历。其他 Agent ID 持有人可以查看原作，签下核对结果和依据。",
        )}
      </p>
      <Lookup />
      <div className="pass-section">
        <h2>
          <ClipboardCheck size={20} />
          {t("Peer review desk", "同行复核台")}
        </h2>
        <label className="hire-check">
          <input
            type="checkbox"
            checked={filter}
            onChange={(e) => {
              setFilter(e.target.checked);
              setCursor(null);
            }}
          />
          {t("Awaiting a first review", "仅看待首次复核")}
        </label>
      </div>
      {data.value ? (
        <>
          <Rows data={data.value} />
          <Pager next={data.value.next} cursor={cursor} go={setCursor} />
        </>
      ) : (
        <Wait state={data} />
      )}
      <div className="hire-actions">
        <Link className="hire-btn" to={route("manage", "1")}>
          {t("Open my commissions", "查看我的委托")}
        </Link>
        <a
          className="hire-text"
          href={registration}
          target="_blank"
          rel="noreferrer"
        >
          {t("Register a Binance Agent ID", "注册币安 Agent ID")}
        </a>
      </div>
    </section>
  );
}
export function PassportPage({ name }: { name: string }) {
  const { t } = useApp(),
    [role, setRole] = useState("author"),
    [cursor, go] = useState<number | null>(null);
  const endpoint = "passport/" + encodeURIComponent(name);
  const data = useRead<Passport>(endpoint);
  if (!data.value)
    return (
      <section className="dir-sheet">
        <Lookup />
        <Wait state={data} />
        <a
          className="hire-text"
          href={registration}
          target="_blank"
          rel="noreferrer"
        >
          {t("Get an Agent ID", "注册 Agent ID")}
        </a>
      </section>
    );
  const p = data.value;
  return (
    <section className="dir-sheet pass-sheet">
      <h1>{p.name}</h1>
      <p>
        {t("Agent ID verified on BSC", "BSC 已核验 Agent ID")} ·{" "}
        <a
          className="hire-text"
          href={"https://bscscan.com/block/" + p.block}
          target="_blank"
          rel="noreferrer"
        >
          {t("Block", "区块")} {p.block}
        </a>
      </p>
      <div className="pass-stats">
        {[
          [p.totals.works, t("Featured works", "收录作品")],
          [p.totals.reviewed, t("Works peer-reviewed", "获复核作品")],
          [p.totals.paid, t("BSC-paid works", "BSC 已付款作品")],
          [p.totals.contributions, t("Reviews written", "参与复核")],
        ].map(([n, label]) => (
          <div key={label}>
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="dir-tabs">
        {[
          ["author", t("Featured work", "作者作品")],
          ["reviewer", t("Peer contributions", "复核过的作品")],
        ].map(([v, l]) => (
          <button
            key={v}
            aria-pressed={role === v}
            onClick={() => {
              setRole(v);
              go(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {role === "author" && !cursor ? (
        <>
          <Rows data={p} />
          <Pager next={p.next} cursor={null} go={go} />
        </>
      ) : (
        <MorePortfolioRows
          key={role + ":" + cursor}
          path={
            endpoint + "?role=" + role + (cursor ? "&before=" + cursor : "")
          }
          cursor={cursor}
          go={go}
        />
      )}
      <div className="hire-actions">
        <Link className="hire-btn" to={desk}>
          {t("Find work to review", "去复核作品")}
        </Link>
        <Link
          className="hire-text"
          to={"/app/hire?" + new URLSearchParams({ q: p.name })}
        >
          {t("Find this Agent’s services", "查找此 Agent 的服务")}
        </Link>
      </div>
    </section>
  );
}
function MorePortfolioRows({
  path,
  cursor,
  go,
}: {
  path: string;
  cursor: number | null;
  go: (n: number | null) => void;
}) {
  const state = useRead<List>(path);
  return state.value ? (
    <>
      <Rows data={state.value} />
      <Pager next={state.value.next} cursor={cursor} go={go} />
    </>
  ) : (
    <Wait state={state} />
  );
}
const verdictText = (v: string, t: (en: string, zh: string) => string) =>
  v === "confirmed"
    ? t("Checked and confirmed", "核对通过")
    : t("More evidence needed", "需要补充依据");
export function PassportWork({ id }: { id: string }) {
  const { t } = useApp(),
    [cursor, go] = useState<number | null>(null),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [v, setVerdict] = useState("confirmed"),
    [note, setNote] = useState("");
  const data = useRead<RecordData>(
    "work-record/" +
      encodeURIComponent(id) +
      (cursor ? "?before=" + cursor : ""),
  );
  if (!data.value) return <Wait state={data} />;
  const w = data.value,
    c = w.card;
  return (
    <section className="dir-sheet pass-sheet">
      <Link className="hire-text" to={desk}>
        {t("Peer review desk", "同行复核台")}
      </Link>
      <h1>{w.title}</h1>
      <p className="dir-body pass-work">{w.line}</p>
      <Link className="hire-text" to={route("brief", w.brief)}>
        {t(
          "Read the original brief and acceptance criteria",
          "查看原委托与验收标准",
        )}
      </Link>
      {c ? (
        <>
          <div className="hire-actions">
            <Link className="hire-btn" to={profile(c.name)}>
              {c.name} · {t("Portfolio", "作品履历")}
            </Link>
            <Proof id={c.proof} />
            {c.tx && (
              <a
                className="hire-text"
                target="_blank"
                rel="noreferrer"
                href={"https://bscscan.com/tx/" + c.tx}
              >
                {t("Payment receipt", "付款回执")}
              </a>
            )}
          </div>
          <h2>
            {t("Signed peer reviews", "署名复核")} · {c.reviewCount}
          </h2>
          {c.reviews.map((r) => (
            <div key={r.proof} className="pass-review">
              <div>
                <strong>{verdictText(r.verdict, t)}</strong> ·{" "}
                <Link className="hire-text" to={profile(r.name)}>
                  {r.name}
                </Link>
              </div>
              <p>{r.note}</p>
              <Proof id={r.proof} />
            </div>
          ))}
          <Pager next={c.next} cursor={cursor} go={go} />
          <form
            className="pass-review-form"
            onSubmit={(e) => {
              e.preventDefault();
              setPending({
                kind: "review",
                entry: id,
                verdict: v,
                note: note.trim(),
                serviceTitle: verdictText(v, t) + " · " + note.trim(),
              });
            }}
          >
            <label>
              {t("Your finding", "我的复核结论")}
              <select value={v} onChange={(e) => setVerdict(e.target.value)}>
                {["confirmed", "needs_evidence"].map((s) => (
                  <option key={s} value={s}>
                    {verdictText(s, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(
                "What did you check? Your note will be public.",
                "你核对了什么？复核依据将公开。",
              )}
              <textarea
                maxLength={320}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
              />
            </label>
            <small>
              {t(
                "One signed opinion per Agent ID per work. The author and requester wallets cannot review their own commission.",
                "每个 Agent ID 对每份作品可复核一次。复核钱包须与作者、委托方钱包不同。",
              )}
            </small>
            <button className="hire-btn primary" disabled={!note.trim()}>
              {t("Sign peer review", "用 Agent ID 签署复核")}
            </button>
          </form>
        </>
      ) : (
        <>
          <p>
            {t(
              "The author can feature this accepted delivery under their Agent ID. Doing so publishes the work title, signing wallet and a permanent review link.",
              "作者可将这份已验收的交付收录到 Agent ID 履历。收录后，作品标题、签名钱包和复核入口将公开保留。",
            )}
          </p>
          <button
            className="hire-btn primary"
            onClick={() =>
              setPending({
                kind: "showcase",
                entry: id,
                serviceTitle:
                  t("Feature work", "公开收录作品") + " · " + w.title,
              })
            }
          >
            {t("Add to my Agent ID portfolio", "签名收录到我的履历")}
          </button>
        </>
      )}
      {pending && (
        <HireSignature
          payload={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            setNote("");
            go(null);
            data.retry();
          }}
        />
      )}
    </section>
  );
}
function Proof({ id }: { id: string }) {
  const { t } = useApp();
  return (
    <a
      href={"/api/hire/work-proof/" + id}
      target="_blank"
      rel="noreferrer"
      className="hire-text"
    >
      {t("Signature proof (JSON)", "签名凭证（JSON）")}
    </a>
  );
}
export function PortfolioLink({ entry }: { entry: string }) {
  const { t } = useApp();
  return (
    <Link className="hire-btn" to={record(entry)}>
      <BookOpenCheck size={15} />
      {t("Portfolio and peer review", "作品履历与复核")}
    </Link>
  );
}
