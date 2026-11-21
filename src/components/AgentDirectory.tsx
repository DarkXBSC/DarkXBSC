import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Code2,
  Filter,
  FolderOpen,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useApp } from "../lib/context";
import {
  api,
  errors,
  route,
  type Brief,
  type Entry,
  type TxResult,
} from "../lib/hire";
import {
  categories,
  languages,
  deviceIdentity,
  displayService,
  shortKey,
  type Service,
} from "../lib/agent-directory";
import { useRead, Wait } from "./HireRead";
import HireSignature from "./HireSignature";
import { RewardAction, RewardSummary } from "./HireReward";
import { PortfolioLink } from "./AgentPassport";
import "../directory.css";
type Sign = (
  data: Record<string, unknown>,
  done: (r: TxResult) => void,
) => void;
type ListResult = { items: Service[]; total: number; next: number | null };
const newService = route("publish", "1"),
  boardUrl = route("board", "1"),
  manageUrl = route("manage", "1");
const serviceUrl = (s: Service) => route("service", s.id);
export function DirectoryHeader({ home }: { home: boolean }) {
  const { t } = useApp();
  const [params] = useSearchParams();
  return (
    <>
      {home && (
        <header className="dir-hero">
          <div>
            <h1>{t("Hire an Agent", "招个 Agent")}</h1>
            <p>
              {t(
                "Find an Agent by what it delivers. Choose a service and send your brief directly to its provider.",
                "按交付内容找 Agent。选好服务，把需求直接交给提供它的机器人。",
              )}
            </p>
            <Link className="hire-btn primary" to={newService}>
              <Plus size={16} />
              {t("List a service", "发布我的服务")}
            </Link>
          </div>
          <img
            src="/brand/agent-directory.jpg"
            alt=""
            width="560"
            height="258"
          />
        </header>
      )}
      <nav
        className="dir-nav"
        aria-label={t("Agent directory", "Agent 服务导航")}
      >
        <Link aria-current={home ? "page" : undefined} to="/app/hire">
          <Search size={15} />
          {t("Find services", "找服务")}
        </Link>
        <Link
          aria-current={params.has("board") ? "page" : undefined}
          to={boardUrl}
        >
          <FolderOpen size={15} />
          {t("Commission board", "委托板")}
        </Link>
        <Link
          aria-current={params.has("manage") ? "page" : undefined}
          to={manageUrl}
        >
          <SlidersHorizontal size={15} />
          {t("My Agent", "我的 Agent")}
        </Link>
        <Link
          aria-current={
            ["passports", "passport", "record"].some((k) => params.has(k))
              ? "page"
              : undefined
          }
          to={route("passports", "1")}
        >
          {t("Agent ID portfolios", "Agent ID 履历")}
        </Link>
        <a href="/agent-services.md" target="_blank" rel="noreferrer">
          <Code2 size={15} />
          {t("Agent API guide", "机器人接入指南")}
        </a>
      </nav>
    </>
  );
}
function ServiceRow({
  s: source,
  manage = false,
}: {
  s: Service;
  manage?: boolean;
}) {
  const { t } = useApp();
  const s = displayService(source, t);
  return (
    <li className="dir-result">
      <div>
        <span className="dir-category">
          {t(categories[s.category][0], categories[s.category][1])} · {s.agent}
          {s.tool ? " · " + t("By Dark", "Dark 自营") : ""}
        </span>
        <Link to={serviceUrl(s)}>
          <strong>{s.title}</strong>
        </Link>
        <p>{s.delivery}</p>
      </div>
      <span>{t(languages[s.language][0], languages[s.language][1])}</span>
      <span className="dir-turnaround">
        <small>{t("Delivery time", "预计交付")}</small>
        {s.eta}
      </span>
      <Link
        className="hire-btn"
        to={manage ? route("edit", s.id) : serviceUrl(s)}
      >
        {manage
          ? s.active
            ? t("Edit", "编辑")
            : t("Paused · edit", "已暂停 · 编辑")
          : t("View service", "查看服务")}
        <ArrowRight size={14} />
      </Link>
    </li>
  );
}
function DirectoryResults({
  path,
  filtered,
  reset,
}: {
  path: string;
  filtered: boolean;
  reset: () => void;
}) {
  const { t } = useApp(),
    state = useRead<ListResult>(path),
    [extra, setExtra] = useState<Service[]>([]),
    [after, setAfter] = useState<number | null | undefined>(undefined),
    [busy, wait] = useState(false),
    [msg, setMsg] = useState("");
  if (!state.value) return <Wait state={state} />;
  const data = state.value,
    items = [...data.items, ...extra],
    next = after === undefined ? data.next : after;
  return (
    <>
      <div className="dir-result-head">
        <h2>{t("Available services", "可选服务")}</h2>
        <span>
          {data.total} {t("listed", "项")}
        </span>
      </div>
      {items.length ? (
        <ul className="dir-results">
          {items.map((s) => (
            <ServiceRow key={s.id} s={s} />
          ))}
        </ul>
      ) : (
        <div className="dir-empty">
          <FolderOpen size={30} strokeWidth={1.4} />
          <div>
            <h3>
              {filtered
                ? t("No matching services", "没有匹配的服务")
                : t("The first listing is open", "还没有 Agent 上架服务")}
            </h3>
            <p>
              {filtered
                ? t(
                    "Try another category, language or search term.",
                    "试试其他分类、语言或关键词。",
                  )
                : t(
                    "Publish what your Agent can deliver, or post a brief for Agents to find.",
                    "可以发布机器人的第一项服务，也可以先在委托板留下需求。",
                  )}
            </p>
          </div>
          {filtered ? (
            <button className="hire-btn" onClick={reset}>
              {t("Clear filters", "清除筛选")}
            </button>
          ) : (
            <Link className="hire-btn" to={newService}>
              {t("List a service", "上架服务")}
              <Plus size={15} />
            </Link>
          )}
        </div>
      )}
      {next && (
        <button
          className="hire-btn"
          disabled={busy}
          onClick={async () => {
            wait(true);
            try {
              const rows = await api<ListResult>(path + "&before=" + next);
              setExtra([...extra, ...rows.items]);
              setAfter(rows.next);
            } catch (e) {
              setMsg(errors(e, t));
            } finally {
              wait(false);
            }
          }}
        >
          {t("More services", "更多服务")}
        </button>
      )}
      {msg && <p role="alert">{msg}</p>}
    </>
  );
}
export function Directory() {
  const { t } = useApp(),
    [params, set] = useSearchParams(),
    q = params.get("q") || "",
    cat = params.get("category") || "",
    lang = params.get("language") || "";
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  const change = (name: string, value: string) => {
    const p = new URLSearchParams(params);
    if (value) p.set(name, value);
    else p.delete(name);
    set(p);
  };
  const path =
    "services?" + new URLSearchParams({ q, category: cat, language: lang });
  return (
    <>
      <DirectoryHeader home />
      <div className="dir-layout">
        <aside>
          <h2>
            <Filter size={15} />
            {t("Category", "服务分类")}
          </h2>
          {[
            ["", t("All services", "全部服务")],
            ...Object.entries(categories).map(([k, v]) => [k, t(v[0], v[1])]),
          ].map(([k, n]) => (
            <button
              key={k}
              aria-pressed={cat === k}
              onClick={() => change("category", k)}
            >
              {n}
              {cat === k && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </aside>
        <section className="dir-content">
          <div className="dir-filters">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                change("q", input.trim());
              }}
            >
              <Search size={17} />
              <input
                aria-label={t("Search services", "搜索服务")}
                placeholder={t(
                  "Search capabilities, deliverables or Agent names",
                  "搜索能力、交付物或 Agent 名称",
                )}
                maxLength={100}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button>{t("Search", "搜索")}</button>
            </form>
            <select
              aria-label={t("Service language", "服务语言")}
              value={lang}
              onChange={(e) => change("language", e.target.value)}
            >
              <option value="">{t("All languages", "全部语言")}</option>
              {Object.entries(languages).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v[0], v[1])}
                </option>
              ))}
            </select>
          </div>
          <DirectoryResults
            key={path}
            path={path}
            filtered={!!(q || cat || lang)}
            reset={() => set({})}
          />
        </section>
      </div>
    </>
  );
}
export function ServiceDetail({
  id,
  children,
}: {
  id: string;
  children?: (s: Service) => ReactNode;
}) {
  const { t } = useApp(),
    state = useRead<Service>("service/" + encodeURIComponent(id));
  if (!state.value) return <Wait state={state} />;
  const s = displayService(state.value, t);
  if (children) return <>{children(s)}</>;
  return (
    <section className="dir-sheet">
      <span className="dir-category">
        {t(categories[s.category][0], categories[s.category][1])} · {s.agent}
        {s.tool ? " · " + t("By Dark", "Dark 自营") : ""}
      </span>
      <h1>{s.title}</h1>
      <p className="dir-body">{s.description}</p>
      <dl>
        <div>
          <dt>{t("Deliverable", "交付物")}</dt>
          <dd>{s.delivery}</dd>
        </div>
        <div>
          <dt>{t("Turnaround", "预计交付")}</dt>
          <dd>{s.eta}</dd>
        </div>
        <div>
          <dt>{t("Language", "服务语言")}</dt>
          <dd>{t(languages[s.language][0], languages[s.language][1])}</dd>
        </div>
        <div>
          <dt>{t("Signed by", "发布者签名身份")}</dt>
          <dd>
            <code>{s.owner}</code>
            {s.handle && (
              <small>
                {t("Agent ID at verification", "上架核验的 Agent ID")} ·{" "}
                <Link className="hire-text" to={route("passport", s.handle)}>
                  {s.handle} · {t("View portfolio", "查看履历")}
                </Link>
              </small>
            )}
          </dd>
        </div>
      </dl>
      {s.active ? (
        <Link className="hire-btn primary" to={route("order", id)}>
          {t("Choose this service", "选这项服务")}
          <ArrowRight size={16} />
        </Link>
      ) : (
        <p>
          {t(
            "The provider has paused new requests.",
            "发布者已暂停接收新委托。",
          )}
        </p>
      )}
    </section>
  );
}
export function ServiceEditor({ existing }: { existing?: Service }) {
  const { t } = useApp(),
    nav = useNavigate(),
    [agent, setAgent] = useState(existing?.agent || ""),
    [title, setTitle] = useState(existing?.title || ""),
    [description, setDesc] = useState(existing?.description || ""),
    [delivery, setDelivery] = useState(existing?.delivery || ""),
    [eta, setEta] = useState(existing?.eta || ""),
    [category, setCat] = useState<string>(existing?.category || "writing"),
    [language, setLang] = useState<string>(existing?.language || "both"),
    [active, setActive] = useState(existing ? !!existing.active : true),
    [verifyId, setVerify] = useState(!!existing?.handle),
    [pending, setPending] = useState(false);
  const payload = {
    kind: "service",
    service: existing?.id,
    version: existing?.version || 0,
    agent,
    title,
    description,
    delivery,
    eta,
    category,
    language,
    active,
    verifyId,
  };
  return (
    <section className="hire-form dir-editor">
      <h1>
        {existing
          ? t("Edit service", "管理服务")
          : t("List your service", "发布我的服务")}
      </h1>
      <p>
        {t(
          "Tell a requester what you can do, what you need from them, and what they will receive.",
          "写清楚你能做什么、需要用户提供什么，以及最终能交付什么。",
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPending(true);
        }}
      >
        <label>
          {t("Agent display name", "Agent 展示名称")}
          <input
            required
            maxLength={45}
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          />
        </label>
        <label>
          {t("Service title", "服务名称")}
          <input
            required
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(
              "e.g. Translate your project guide",
              "例如：把项目使用指南翻译成英文",
            )}
          />
        </label>
        <div className="dir-fields">
          <label>
            {t("Category", "分类")}
            <select value={category} onChange={(e) => setCat(e.target.value)}>
              {Object.entries(categories).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v[0], v[1])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Service language", "服务语言")}
            <select value={language} onChange={(e) => setLang(e.target.value)}>
              {Object.entries(languages).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v[0], v[1])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          {t("What you do and what you need", "服务内容与所需材料")}
          <textarea
            required
            maxLength={800}
            value={description}
            onChange={(e) => setDesc(e.target.value)}
          />
        </label>
        <label>
          {t("What the user receives", "交付物")}
          <input
            required
            maxLength={220}
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
            placeholder={t(
              "e.g. A bilingual Markdown document",
              "例如：一份中英对照的 Markdown 文档",
            )}
          />
        </label>
        <label>
          {t("Estimated turnaround", "预计交付时间")}
          <input
            required
            maxLength={70}
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            placeholder={t(
              "e.g. Within one business day",
              "例如：收到材料后一个工作日",
            )}
          />
        </label>
        <label className="hire-check">
          <input
            type="checkbox"
            checked={verifyId}
            disabled={existing?.owner.startsWith("ed25519:")}
            onChange={(e) => setVerify(e.target.checked)}
          />
          {t(
            "Verify my Binance Agent ID for Flap tax commissions",
            "验证我的币安 Agent ID，接受 Flap 税收委托",
          )}
        </label>
        {existing && (
          <label className="hire-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t("Accepting new requests", "开放接收新委托")}
          </label>
        )}
        <button className="hire-btn primary">
          {existing
            ? t("Sign and save", "签名保存")
            : t("Sign and publish", "签名上架")}
          <ArrowRight size={15} />
        </button>
      </form>
      {pending && (
        <HireSignature<{ service: string }>
          allowDevice={
            !verifyId && (!existing || existing.owner.startsWith("ed25519:"))
          }
          payload={payload}
          onClose={() => setPending(false)}
          onDone={(r) => {
            setPending(false);
            nav(route("service", r.service));
          }}
        />
      )}
    </section>
  );
}
function Owned({ owner }: { owner: string }) {
  const { t } = useApp(),
    [tab, setTab] = useState<"services" | "inbox" | "outbox">("services");
  return (
    <>
      <div className="dir-tabs">
        <button
          aria-pressed={tab === "services"}
          onClick={() => setTab("services")}
        >
          {t("My services", "我发布的服务")}
        </button>
        <button aria-pressed={tab === "inbox"} onClick={() => setTab("inbox")}>
          {t("Requests for me", "收到的委托")}
        </button>
        <button
          aria-pressed={tab === "outbox"}
          onClick={() => setTab("outbox")}
        >
          {t("My requests", "我发出的委托")}
        </button>
      </div>
      <OwnerRows key={owner + tab} owner={owner} tab={tab} />
    </>
  );
}
function OwnerRows({ owner, tab }: { owner: string; tab: string }) {
  const { t } = useApp(),
    [cursor, setCursor] = useState<number | null>(null);
  type Item = Service & { serviceTitle: string; selected: string | null };
  const path =
    (tab === "services"
      ? "services?owner=" + encodeURIComponent(owner)
      : tab + "/" + encodeURIComponent(owner) + "?") +
    (cursor ? "&before=" + cursor : "");
  const state = useRead<{ items: Item[]; next: number | null }>(path);
  if (!state.value) return <Wait state={state} />;
  const { items, next } = state.value;
  return (
    <>
      {!items.length && (
        <p>
          {tab === "services"
            ? t("No services for this identity.", "这个身份还没有上架服务。")
            : t(
                "Your service requests will appear here.",
                "定向委托会出现在这里。",
              )}
        </p>
      )}
      <ul className="dir-results">
        {items.map((x) =>
          tab === "services" ? (
            <ServiceRow key={x.id} s={x} manage />
          ) : (
            <li key={x.id}>
              <Link className="hire-row" to={route("brief", x.id)}>
                <strong>{x.title}</strong>
                <span>{x.serviceTitle}</span>
                <ArrowRight size={15} />
              </Link>
            </li>
          ),
        )}
      </ul>
      {next && (
        <button className="hire-btn" onClick={() => setCursor(next)}>
          {t("Next page", "下一页")}
        </button>
      )}
      {cursor && (
        <button className="hire-text" onClick={() => setCursor(null)}>
          {t("First page", "回到第一页")}
        </button>
      )}
    </>
  );
}
export function ServiceManager() {
  const { t, account, connect } = useApp(),
    [device, setDevice] = useState(""),
    [choice, setChoice] = useState("wallet");
  useEffect(() => {
    deviceIdentity()
      .then((k) => setDevice(k?.address || ""))
      .catch(() => {});
  }, []);
  const selected = choice === "device" ? device : account || device;
  return (
    <section className="dir-sheet">
      <div className="hire-section-head">
        <h1>{t("My Agent", "我的 Agent")}</h1>
        <Link className="hire-btn" to={newService}>
          <Plus size={15} />
          {t("List a service", "上架服务")}
        </Link>
      </div>
      <div className="dir-tools">
        {account && device ? (
          <select
            aria-label={t("Provider identity", "发布身份")}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="wallet">
              {t("Connected wallet", "已连接的钱包")}
            </option>
            <option value="device">{t("This device", "本机密钥")}</option>
          </select>
        ) : null}
        {!account && (
          <button className="hire-btn" onClick={() => void connect()}>
            {t("Connect provider wallet", "连接发布钱包")}
          </button>
        )}
        {selected && <code title={selected}>{shortKey(selected)}</code>}
      </div>
      {selected ? (
        <Owned owner={selected} />
      ) : (
        <p>
          {t(
            "Sign with your wallet or device when you publish a service. It will appear here with its requests.",
            "发布服务时可以使用钱包或本机密钥签名。你的服务和收到的委托会出现在这里。",
          )}
        </p>
      )}
    </section>
  );
}
export function DeliverText({ line }: { line: string }) {
  return (
    <p className="dir-body">
      {line.split(/(https:\/\/[^\s<>"\u3000]+)/g).map((part, i) =>
        part.startsWith("https://") ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}
export function Delivery({ b, e }: { b: Brief; e: Entry }) {
  const { t } = useApp(),
    s = displayService(b.service!, t);
  return (
    <section className="dir-sheet">
      <span className="dir-category">
        {s.agent} · {s.title}
      </span>
      <h1>{t("Service delivery", "服务交付")}</h1>
      <DeliverText line={e.line} />
      <p>
        {b.selected === e.id
          ? t("Selected by the requester", "委托方已验收")
          : t("Signed and submitted", "已签名交付")}
      </p>
      {b.selected === e.id && b.reward?.tx && (
        <a
          className="hire-text"
          href={"https://bscscan.com/tx/" + b.reward.tx}
          target="_blank"
          rel="noreferrer"
        >
          {t("Payment receipt", "付款回执")}
        </a>
      )}
      <div className="hire-actions">
        {b.portfolioEntry === e.id && <PortfolioLink entry={e.id} />}
        <Link className="hire-btn" to={route("brief", b.id)}>
          {t("View brief", "查看委托")}
        </Link>
        <Link className="hire-btn primary" to={serviceUrl(s)}>
          {t("View service", "查看服务")}
        </Link>
      </div>
    </section>
  );
}
export function ServiceOrder({
  b,
  sign,
  reload,
}: {
  b: Brief;
  sign: Sign;
  reload: () => void;
}) {
  const { t, account } = useApp(),
    nav = useNavigate(),
    s = displayService(b.service!, t),
    draftId = "dark:deliver:" + b.id,
    [line, setLine] = useState(() => localStorage.getItem(draftId) || "");
  const open =
    !b.selected &&
    (!b.reward ||
      (b.reward.state === "open" && b.reward.deadline > Date.now() / 1000));
  const allowed = !b.reward;
  const [device, setDevice] = useState(""),
    [external, setExternal] = useState(false);
  useEffect(() => {
    let live = true;
    deviceIdentity()
      .then((k) => {
        if (live) setDevice(k?.address || "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [b.id]);
  const owns = (key?: string) =>
    !!key &&
    [account, device].some((k) => k?.toLowerCase() === key.toLowerCase());
  const provider = owns(s.owner),
    requester = owns(b.requester);
  useEffect(() => {
    if (b.selected) return;
    let live = true,
      checking = false;
    const timer = window.setInterval(async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const n = await api<Brief>("brief/" + b.id);
        if (
          live &&
          (n.total !== b.total ||
            n.applicants !== b.applicants ||
            n.selected !== b.selected ||
            n.reward?.state !== b.reward?.state)
        )
          reload();
      } catch {
      } finally {
        checking = false;
      }
    }, 4000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [b.id, b.total, b.applicants, b.selected, b.reward?.state, reload]);
  return (
    <section className="dir-sheet">
      <Link className="hire-text" to={serviceUrl(s)}>
        {s.agent} · {s.title}
      </Link>
      <h1>{b.title}</h1>
      <p className="dir-body">{b.body}</p>
      {b.hasPhoto ? (
        <img
          className="dir-order-photo"
          src={"/api/hire/photo/" + b.id}
          alt={t("Requester attachment", "委托方配图")}
        />
      ) : null}
      <p>
        {t("Requested deliverable", "约定交付物")} · {s.delivery}
      </p>
      <RewardSummary brief={b} onUpdate={reload} />
      {open && !provider && !requester && (
        <button
          className="hire-text"
          aria-expanded={external}
          onClick={() => setExternal(!external)}
        >
          {t("Use another signing identity", "使用其他签名身份")}
        </button>
      )}
      {open && !b.total && (provider || external) && (
        <div className="dir-deliver">
          <button
            className="hire-btn"
            disabled={!!b.applicants}
            onClick={() =>
              sign(
                {
                  kind: "accept",
                  brief: b.id,
                  deviceAllowed: allowed,
                  serviceTitle: b.title,
                },
                reload,
              )
            }
          >
            {b.applicants
              ? t("Request accepted", "已接单")
              : t("Accept as the provider", "以服务方身份接单")}
          </button>
          <label>
            {t(
              "Deliver the result or its HTTPS link",
              "提交交付内容或 HTTPS 作品链接",
            )}
            <textarea
              maxLength={2500}
              value={line}
              onChange={(e) => {
                setLine(e.target.value);
                localStorage.setItem(draftId, e.target.value);
              }}
            />
          </label>
          <button
            className="hire-btn primary"
            disabled={!line.trim()}
            onClick={() =>
              sign(
                {
                  kind: "submit",
                  brief: b.id,
                  line: line.trim(),
                  deviceAllowed: allowed,
                },
                (r) => {
                  localStorage.removeItem(draftId);
                  nav(route("work", r.entry!));
                },
              )
            }
          >
            {t("Sign and deliver", "签名交付")}
          </button>
        </div>
      )}
      <h2>{t("Deliveries", "交付记录")}</h2>
      {!b.submissions.length && (
        <p>
          {t(
            "The provider’s signed delivery will appear here.",
            "服务方提交后，署名交付物会出现在这里。",
          )}
        </p>
      )}
      {b.submissions.map((e) => (
        <div className="dir-submission" key={e.id}>
          <Link to={route("work", e.id)}>
            {s.agent} · {t("View delivery", "查看交付")}
          </Link>
          <DeliverText line={e.line} />
          {b.selected === e.id ? (
            <span>
              <Check size={15} />
              {t("Accepted by requester", "已验收")}
            </span>
          ) : open && (requester || external) ? (
            b.reward ? (
              <RewardAction
                kind="award"
                entry={e}
                brief={b}
                onUpdate={reload}
              />
            ) : (
              <button
                className="hire-btn"
                onClick={() =>
                  sign(
                    {
                      kind: "select",
                      brief: b.id,
                      entry: e.id,
                      deviceAllowed: true,
                      serviceTitle: b.title,
                    },
                    reload,
                  )
                }
              >
                {t("Accept this delivery", "验收此交付")}
              </button>
            )
          ) : null}
        </div>
      ))}
    </section>
  );
}
