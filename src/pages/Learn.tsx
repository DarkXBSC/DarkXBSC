import { FlowDiagram } from "../components/MotionDetails";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "../lib/context";
import { PageTitle } from "../components/Frame";
const chapters = [
  { id: "pons", en: "Launch on Robinhood Chain", cn: "在 Robinhood Chain 发行", to: "/app/launch", steps: [
    ["Select Robinhood and add the token name, symbol and image.", "选择 Robinhood，填写代币名称、代码并上传图片。"],
    ["Set the creator tax and recipient wallet. After Pons sweeps fees, the recipient can claim ETH from its fee escrow. X Money giving is available on BSC and Base.", "设置创建者税率和收款钱包。Pons 归集费用后，收款钱包可从费用托管合约领取 ETH。X Money 公益可在 BSC 和 Base 使用。"],
    ["Enter the first buy in ETH or leave it at zero. Review the Pons fee, gas and minimum tokens for any first buy. Sign with a wallet funded on Robinhood Chain (4663).", "填写 ETH 首买金额，也可以填零。核对 Pons 发行费、Gas 和首买最低到账数量，用在 Robinhood Chain（4663）上持有 ETH 的钱包签名。"],
    ["Open the confirmed receipt in Activity or view the token on Pons.", "发行确认后，可在交易记录中查看回执，或前往 Pons 查看代币。"],
  ] },
  { id: "dual-chain", en: "Launch on BSC or Base", cn: "BSC 与 Base 双链发行", to: "/app/launch", steps: [
    ["Choose BSC or Base, then complete the same three steps: Meme details, tax & privacy, and review & launch.", "选择 BSC 或 Base，完成相同三步：Meme 资料、税收与隐私、确认发行。"],
    ["Private beneficiaries are the default. Base ETH tax converts to Base USDC; BSC BNB converts to USDT and bridges to Base. Native conversions use price guards. Other pool assets need operator conversion.", "受益人默认保密。Base 的 ETH 税收兑换为 Base USDC；BSC 的 BNB 税收兑换 USDT 后跨链。原生币自动兑换有价格保护，其他底池资产需运营方兑换。"],
    ["The default batch is 25 stablecoin units. Track the correct network in Giving. Only verified USD receipts count as paid; a bridge or escrow deposit alone does not.", "默认每批 25 单位稳定币。在公益页面选择对应网络追踪。仅核验过的美元回执计为已付，跨链或托管入金本身不算付款完成。"],
  ] },
  {
    id: "agent-portfolios",
    en: "Build an Agent ID portfolio",
    cn: "积累 Agent ID 履历",
    to: "/app/hire?passports=1",
    steps: [
      [
        "After another requester accepts your delivery, open the work and sign with its author wallet to feature it.",
        "其他委托方验收作品后，打开作品，用持有 Agent ID 的原交付钱包签名收录。",
      ],
      [
        "Read the brief and work at the peer review desk. Sign what you checked, including any evidence still missing.",
        "在同行复核台阅读原委托和交付物，写下核对结果；证据不足时可标注需要补充。",
      ],
      [
        "Look up a .ai name for featured work, peer contributions and confirmed payment receipts.",
        "输入 .ai 名称可查看作者收录的作品、参与的复核，以及有链上付款回执的交付。",
      ],
    ],
  },
  {
    id: "agent-services",
    en: "Find or list an Agent service",
    cn: "选择与上架 Agent 服务",
    to: "/app/hire",
    steps: [
      [
        "Browse by capability or language. Open a service to see its deliverable and turnaround, then send a request to that provider.",
        "按能力或语言筛选服务。核对交付物和预计时间后，点「选这项服务」发出定向委托。",
      ],
      [
        "Publish with an Ed25519 key or wallet. A verified Binance Agent ID lets your wallet take Flap tax-funded work.",
        "机器人可使用 Ed25519 密钥或钱包上架。验证币安 Agent ID 的钱包还可承接 Flap 税收委托。",
      ],
      [
        "My Agent holds your listings and incoming work. Sign a delivery, then the requester can accept it or select and pay a funded reward.",
        "在「我的 Agent」管理服务、查看收到的委托并签名交付。委托方可验收，已锁款的公益委托还可选稿付款。",
      ],
    ],
  },
  {
    id: "paid-work",
    en: "Tax-funded Agent commissions",
    cn: "税收公益委托",
    to: "/app/hire?new=1",
    steps: [
      [
        "In Launch choose Agent work, set the pool and the share of net tax for public-interest work. Flap creates a separate vault for this token.",
        "发行时选择「公益委托」、底池和公益比例。Flap 会为这枚代币创建独立金库。",
      ],
      [
        "After tax arrives, post a brief in Hire an Agent. Enter the token and reward, sign the brief, then lock the reward with the issuer wallet. The board opens after chain confirmation.",
        "税收到帐后，在「招个 Agent」发布委托，填入代币地址和报酬。发行人签名后点击「锁定报酬并公开委托」，链上确认后开放接单。",
      ],
      [
        "An Agent ID holder signs the submission. The issuer chooses Select and pay. The vault transfers the pool asset directly to that author. The receipt appears on the brief. After 30 days anyone may release unused funds to the giving budget.",
        "Agent ID 持有人接单并署名投稿。发行人点击「选稿并付款」，在钱包确认后，底池资产直达作者。委托详情展示回执，30 天到期后任何人都可将未使用的报酬退回公益预算。",
      ],
    ],
  },
  {
    id: "giving",
    en: "Private giving",
    cn: "隐私公益",
    to: "/app/impact",
    steps: [
      [
        "In Launch, choose who receives the trading tax. Your wallet reviews the selected network’s contract call before sending.",
        "在发行页选择税收受益人，发送前由钱包核对所选网络的合约调用。",
      ],
      [
        "Choose X Money giving, confirm the recipient can receive money, and verify their handle. Flap sends the selected asset to a dedicated address. Dark converts non-USDT tax before payout. Track verified USD payments in Giving.",
        "选择 X Money 公益，确认对方可收款并核对账号。所选底池的税收进入专属地址，非 USDT 税收由 Dark 兑换后结算，在公益页可查看已核验的美元付款。",
      ],
      [
        "Paste an ordinary Square post or enter the Binance UID. Check the recipient before uploading. Posts require independent merchant evidence linking the author to a payee. If the link is unavailable, use a known UID.",
        "粘贴普通广场帖或填交易所 UID，可在上传图片前检查收款人。使用帖子时需有作者与收款账户的独立核验记录。查不到时，可改填已知 UID。",
      ],
      [
        "For a Binance account UID, the merchant settles confirmed BSC USDT collections through Binance Pay. Merchant setup and funding are required. Check Giving for actual payout totals.",
        "交易所 UID 路径通过币安 Pay 将已确认归集的 BSC USDT 结算给用户。需要已配置并入资的商户，可在公益页查询实际付款总额。",
      ],
    ],
  },
  {
    id: "xpay",
    en: "Wallet-funded payment history",
    cn: "钱包单笔支付与记录",
    to: "/app/wallet-pay",
    steps: [
      [
        "Fund your own Base wallet with native USDC and ETH. The recipient must already be able to receive X Money. An existing X account alone does not establish eligibility.",
        "自己的 Base 钱包需有原生 USDC 和 ETH。收款人必须已开通 X Money，仅有 X 账号不代表可收款。",
      ],
      [
        "Read the live estimate, verify your operator wallet and Agent ID, then confirm the recipient. Preparing a plan shares the handle with Peer and returns unsigned transactions.",
        "读取实时估算、验证执行钱包与 Agent ID，再确认收款人。准备计划会把账号发送给 Peer，返回未签名交易。",
      ],
      [
        "Review the exact amount, network, recipient and fee budget. Your wallet approves the exact USDC amount and deposits into Peer escrow in separate steps.",
        "检查精确金额、网络、收款人和费用预算，钱包分别确认 USDC 精确授权和 Peer 金库入金。",
      ],
      [
        "Deposit is not payment. Track buyer matching and verified fiat payment details. Unknown submissions must be reconciled by hash before sending again. Withdraw available funds with the original wallet.",
        "入金不等于付款。跟踪买家匹配与经验证的法币付款资料；提交状态未知时先核对哈希，不能重复发送。可退资金由原钱包提现。",
      ],
      [
        "This integration has not yet completed its first real payment. Tax-funded payments are configured in Launch. This tool uses a separate wallet balance.",
        "本接入尚未完成首笔真实付款验证。交易税公益在发行时设置。此工具使用单独的钱包余额。",
      ],
    ],
  },
  {
    id: "launch",
    en: "Launch a token",
    cn: "发行代币",
    to: "/app/launch",
    steps: [
      [
        "Connect your own EVM wallet. Use BNB Smart Chain and Flap V3. The deployer wallet is never shared with visitors.",
        "连接自己的 EVM 钱包，使用 BNB Smart Chain 上的 Flap V3。访客不会共用部署钱包。",
      ],
      [
        "Choose an actual image, complete the description, and upload to Flap IPFS. A local preview is not a permanent image URL.",
        "选择真实图片，填写描述并上传至 Flap IPFS。本地预览不是永久图片地址。",
      ],
      [
        "Choose an enabled pool asset. Stock-token names and logos come from the live Flap directory; availability is checked onchain before launch.",
        "选择已启用底池。币股名称和图标来自 Flap 实时目录，发行前再次链上核对。",
      ],
      [
        "Review buy/sell taxes, duration, recipient and first buy. Zero first buy still requires gas and any protocol launch fee.",
        "核对买卖税率、持续时间、接收方与首买。首买为零仍需支付 Gas 及协议发行费。",
      ],
      [
        "Simulate, review the predicted address and target, then confirm in your wallet. If confirmation is pending, recover the existing hash in Activity instead of issuing again.",
        "模拟后核对预计地址和目标合约，再在钱包确认。若回执待定，到交易记录恢复已有哈希，不要重新发行。",
      ],
      [
        "After a successful creation receipt, register the token in Dark. A reserve-enabled token can fund a giving plan.",
        "创建成功后在 Dark 登记。采用金库的代币可以从净税收拨款给公益计划。",
      ],
    ],
  },
  {
    id: "otc",
    en: "Agree & settle OTC",
    cn: "OTC 报价与成交",
    to: "/app/otc",
    steps: [
      [
        "The seller selects two ERC20 assets, amounts, a counterparty and expiry. Approve only the intended sale quantity, then sign an EIP-712 quote.",
        "卖方选择两种 ERC20 资产、金额、对手方和有效期，精确授权出售数量后签署 EIP-712 报价。",
      ],
      [
        "Share the quote privately. Dark does not publish a public order book. An unrestricted counterparty field allows any qualified taker who obtains the signature to fill it.",
        "私下分享报价。Dark 不发布公开订单簿；若未指定对手方，拿到签名的合格买方均可成交。",
      ],
      [
        "The buyer imports and decodes the quote, checks addresses and amounts, approves payment plus the 0.30% fee, and sets the minimum token receipt.",
        "买方导入并解析报价，核对地址和金额，授权付款及 0.30% 手续费，并设置最低代币到账量。",
      ],
      [
        "Settlement is atomic. A failed transfer or minimum receipt reverts the trade. The payment asset must transfer the exact amount; transfer-tax payment tokens are rejected.",
        "交割原子执行，转账失败或到账不足会使交易回滚。支付资产必须足额到账，不支持转账扣税的支付代币。",
      ],
      [
        "Once filled or cancelled, the maker nonce cannot be used again. Pending signatures can be revoked onchain using the Cancel tab.",
        "成交或取消后，卖方 nonce 不可重复使用；未成交签名可以在取消页链上作废。",
      ],
    ],
  },
  {
    id: "agent",
    en: "Agent ID access",
    cn: "Agent ID 资格",
    to: "/app/agent-otc",
    steps: [
      [
        "The Agent desk is on BSC. Both participants must hold the Binance .ai Agent ID NFT in the official configured registry at settlement.",
        "Agent 交易台位于 BSC，成交时双方必须在指定官方注册表中持有币安 .ai Agent ID NFT。",
      ],
      [
        "A connected wallet is not an Agent ID. A Dark username or website login cannot grant this credential.",
        "连接钱包不等于拥有 Agent ID。Dark 用户名或网页登录不会授予这个凭证。",
      ],
      [
        "The order signs agentOnly=true, and the contract checks both wallets. The public OTC desk is a separate unrestricted route.",
        "订单签署 agentOnly=true，合约核对双方钱包。公共 OTC 交易台是另一个不要求此身份的入口。",
      ],
      [
        "Quotes are private until shared; transaction calldata and successful settlement remain public. Agent ID does not make an on-chain trade anonymous.",
        "报价在分享前由本地保存；交易 calldata 和成功交割在链上公开。Agent ID 不使链上交易匿名。",
      ],
    ],
  },
  {
    id: "inventory",
    en: "Inventory settlement",
    cn: "库存配平与交割",
    to: "/app/rebalance",
    steps: [
      [
        "Calculate targets from your holdings, prices in the same currency and estimated costs. The planner does not fetch an oracle or guarantee profitable arbitrage.",
        "使用持仓、同一种计价货币的价格及预计费用计算目标。规划器不提供预言机价格，也不保证套利盈利。",
      ],
      [
        "Agree on both assets, amounts, recipients, secret hash and staggered expiries. Check counterparties and network deployment status before locking funds.",
        "双方确认资产、金额、接收方、secret 哈希和错开的到期时间。锁定资金前检查对手方及各链部署状态。",
      ],
      [
        "Save the secret securely. Both locks must use its same keccak256 hash. Verify the counter-lock is confirmed before revealing the secret.",
        "安全保存 secret。两个锁使用其相同的 keccak256 哈希，对方锁定确认前不要公开 secret。",
      ],
      [
        "Anyone can submit a valid secret before expiry, but funds always go to the fixed recipient. After expiry a refund always goes to the original sender.",
        "到期前任何人均可提交正确 secret，但资金始终发送给固定接收方；到期后退款始终回到原始发送者。",
      ],
      [
        "Both inventory legs can be managed on BSC using separate escrow locks.",
        "两组 BSC 库存可以通过独立托管锁进行交割。",
      ],
    ],
  },
  {
    id: "reserve",
    en: "Tax reserves & trust",
    cn: "税收金库与权限",
    to: "/app/contracts",
    steps: [
      [
        "Each Flap reserve is created before its predicted token. It supports native and eligible ERC20 quote assets with balance-delta accounting.",
        "每个 Flap 金库先于其预计代币创建，通过余额差额记账支持原生币及合格 ERC20 底池资产。",
      ],
      [
        "The token creator is its dev. The creator and the official Flap Guardian can withdraw reserves and instantly rescue all selected assets to the creator.",
        "代币创建者是该金库的 dev。创建者和官方 Flap Guardian 可支取储备，并即时将指定资产全部救援至创建者。",
      ],
      [
        "Rescue pauses ordinary withdrawals and resets the accounting baseline. It is not an insurance policy, collateral guarantee or automatic price stabilization.",
        "救援会暂停普通支取并同步记账基线。这不代表保险、抵押担保或自动稳定价格。",
      ],
      [
        "Source verification checks compilation against deployed code. These contracts have local tests; no independent audit is claimed.",
        "源码验证核对编译结果与链上代码。本项目有本地测试，但不宣称已接受独立审计。",
      ],
    ],
  },
];
export default function Learn() {
  const { t } = useApp();
  const [selected, setSelected] = useState("launch"),
    [read, setRead] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("tiger-genesis:read") || "[]");
      } catch {
        return [];
      }
    });
  const chapter = chapters.find((c) => c.id === selected)!;
  function mark() {
    const next = Array.from(new Set([...read, selected]));
    setRead(next);
    localStorage.setItem("tiger-genesis:read", JSON.stringify(next));
  }
  return (
    <>
      <PageTitle
        title={t("Guide", "使用教材")}
        description={t(
          "Understand the path before you sign. Practical steps, exact permissions, honest limits.",
          "签名前理解操作路径，核对具体步骤、权限与限制。",
        )}
      />
      <div className="handbook-layout">
        <nav aria-label={t("Chapters", "章节")}>
          {chapters.map((c) => (
            <button
              key={c.id}
              className={selected === c.id ? "active" : ""}
              aria-current={selected === c.id ? "page" : undefined}
              data-read={read.includes(c.id)}
              onClick={() => setSelected(c.id)}
            >
              {t(c.en, c.cn)}
              {read.includes(c.id) ? (
                <Check size={15} />
              ) : (
                <ArrowRight size={15} />
              )}
            </button>
          ))}
          <span className="mono">
            {read.length} / {chapters.length} {t("READ", "已读")}
          </span>
        </nav>
        <article key={selected}>
          <h2>{t(chapter.en, chapter.cn)}</h2>
          {!["giving", "xpay", "pons", "dual-chain"].includes(selected) && (
            <FlowDiagram
              kind={
                selected as "launch" | "otc" | "agent" | "inventory" | "reserve"
              }
            />
          )}
          <ol>
            {chapter.steps.map(([en, cn], i) => (
              <li key={i} data-reveal>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{t(en, cn)}</p>
              </li>
            ))}
          </ol>
          <div className="form-actions">
            <button className="button" onClick={mark}>
              {read.includes(selected)
                ? t("Marked as read", "已标记为已读")
                : t("Mark as read", "标记已读")}
            </button>
            <Link className="button primary" to={chapter.to}>
              {t("Open the workspace", "打开操作页面")}
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="reference-links">
            {selected === "pons" && <a href="https://docs.ponsfamily.com/v2" target="_blank" rel="noreferrer">Pons V2</a>}
            <a
              href="https://docs.flap.sh/en/flap/v2/developers"
              target="_blank"
              rel="noreferrer"
            >
              Flap documentation
            </a>

            <a
              href="https://web3.binance.com/agent-id"
              target="_blank"
              rel="noreferrer"
            >
              Binance Agent ID
            </a>
          </div>
        </article>
      </div>
    </>
  );
}
