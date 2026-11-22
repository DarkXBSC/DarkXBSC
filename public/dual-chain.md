# BSC + Base issuance and private giving

Updated 2026-11-22. The launch page keeps the same three steps in Chinese and English. Each launch creates a separate token on the selected network. This release does not bridge the existing Dark token, create a shared supply, or guarantee equal prices across networks.

## Issue a token

1. Select BSC or Base. Add the Meme name, symbol, image and project information. Images are edited locally until you approve publication in step 3.
2. Choose X Money giving or a wallet recipient. BSC also retains its existing commission/reserve and Square routes. Enter an X handle, check the resolved identity, then select private or public disclosure. Private is the default. Select an asset from that chain's actual Flap quote directory and set buy/sell tax, duration and first buy.
3. Review the network, pool, tax and identity visibility. Approve IPFS publication, connect your own wallet, and run the launch check. ERC20 initial purchases require an exact allowance. The final wallet confirmation sends the real Flap call. Only a successful creation receipt is a launch.

Changing networks resets the pool, initial buy, recipient check and unsigned preview. Name, image and private/public choice remain. The wallet switches to chain 56 or 8453 before it signs. Both networks use `newTokenV6`, tax token version 6. Chain-specific CREATE2 predictions use the correct Portal and token implementation.

Base currently supports an ETH native pool and additional assets in Flap's directory. USDC is a settlement asset; the checked Base Portal does not currently enable USDC as a launch pool. Selecting a catalog entry still requires its live onchain configuration and the exact launch simulation to pass. Custom Dark commission/reserve factories and registry remain on BSC; the Base X and wallet paths call Flap directly and need no new Dark factory deployment.

## Tax to X Money

- BSC USDT tax enters a confirmed income ledger directly. Native BNB tax is recorded from the real Flap processor's distribution events, then converted by PancakeSwap V2 to BSC USDT. Confirmed USDT batches bridge through the existing NEAR Intents path to Base USDC.
- Base ETH tax is recorded from the Base processor and converted by Uniswap V2 to native Base USDC. It enters the same payment workflow without a cross-chain transfer.
- Non-native pool assets retain the operator conversion workflow. Their inventory is shown separately. They do not count as stablecoin income until a successful conversion is verified. Unsupported or illiquid conversion paths wait; funds are not treated as USD receipts.
- The default batch is 25 source stablecoin units (BSC USDT / Base USDC). Native conversion requires at least that amount after price protection. A single conversion targets one batch plus up to 2% execution allowance. Bridge and payment fees can reduce the recipient's USD amount.
- Native automatic swaps compare the live DEX quote with fresh Chainlink native/USD and stable/USD feeds. Quotes outside a 2% band, stale data, a stablecoin depeg, or a Base sequencer outage/grace period stop execution. Exact minimum output and a deadline are encoded into the swap. Failed/expired native conversion attempts wait before retrying.
- The existing deployment-wallet signer supplies Gas as needed on each network within its configured transaction limit. Tax principal is reserved separately and never treated as Gas. A low sponsor balance or a high fee pauses that route with an explicit status.
- Peer matches a payer for the recipient's X Money account. Depositing USDC, creating an order, or matching a payer is not payment completion. Only verified USD fills for the exact payee count toward the public paid total. The recipient must be able to receive X Money, and matching liquidity must exist.

## Private beneficiaries

Recipient records stay AES-GCM encrypted in the private server ledger. Each launch has a random credential and each chain scopes the binding ticket; an address, salt, guessed username or a ticket from another chain cannot replace an existing recipient. Public metadata excludes the private handle. Public tracking exposes only purpose, amounts, status, chain and collection address. Explicit public mode includes the profile link.

This is identity minimization, not anonymous blockchain settlement. Wallets, token addresses, amounts and transfers are public. Dark and the identity/payment providers process the recipient identity. Text or an identity baked into the user's uploaded image remains public, so review it before publishing.

## Operations and recovery

The production controller and signer share one SQLite ledger. Migration adds a `chain` column and uniqueness on `(chain, token)` while preserving existing route indices, HD wallet addresses, ciphertext, balances and batches. Nomination links also use chain plus token. A shared Gas nonce journal prevents the two chains' payment routes from racing the same sponsor nonce. Back up the private ledger before migrating. Do not run old single-chain code against a ledger containing Base routes.

Set `X_TAX_AUTO_NATIVE=yes` on the controller and signer to enable the native conversion scheduler. Existing `X_TAX_MIN_USDT` and `X_TAX_MAX_USDT` environment names remain for compatibility; their numeric values apply to each chain's stablecoin at the correct 18/6 decimals. Keep all seeds, private keys and ledger backups outside the web root and source archive.

`npm run x:convert -- list` lists both networks. Operator conversion uses `--chain bsc` or `--chain base`; `--min-usdt` is the legacy flag name for the minimum destination stablecoin amount (USDT on BSC, USDC on Base). Run without `--commit` to inspect; commit requires a unique request ID. Inventory replacement requires a finalized direct stablecoin transfer from the configured deployment wallet before tax assets can be released. Retry is chain-scoped. The HTTP API exposes no arbitrary signing or conversion-commit endpoint.

The Giving tracker accepts `?view=track&chain=base&token=...` or `chain=bsc`. Market, watchlist and chart data use chain-scoped cache keys. The Contracts page identifies third-party Flap contracts separately from Dark's BSC deployments. The official Dark token remains BSC `0x74b6E9dd0DFA02e4a98D1ced7CaaFaad68627777`.

## Launch on Robinhood Chain

Select Robinhood in the same three-step form to launch through [Pons V2](https://ponsfamily.com/launchpad) on chain 4663. Upload the token image, set a creator tax, select a receiving wallet or an X Money beneficiary, and choose an optional initial buy in native ETH. Dark reads the current launch fee, eligibility and tax limit before publishing. Review the required ETH and estimated gas, then confirm in your wallet. A positive first buy uses the Pons router with a minimum token output of 99% of the simulated quote. A zero first buy goes directly to the factory. After confirmation, the receipt links to the explorer and the token can be opened on Pons.

For X Money, choose X giving in step 2, enter the beneficiary's handle and set a positive creator tax. Private mode keeps the handle out of the Pons transaction. Each launch uses its own collector. Dark can sweep eligible curve and pool fees to the Pons escrow as the fee recipient. Graduated pools requiring an internal swap wait for the Pons sweep operator. Dark indexes finalized ETH credits for that launch, claims vested fees and gets a signed NEAR Intents quote targeting 25 native USDC on Base. A fresh Base ETH/USDC oracle price bounds the cost. Robinhood gas comes from the sponsor wallet on chain 4663. If that wallet needs ETH, settlement waits. The tracker distinguishes Pons credits, claimed ETH, finalized Base USDC and evidenced USD payments. Peer matching and an eligible X Money payee are required. An ordinary wallet recipient can claim from the escrow directly. The Contracts page lists the Pons factory and router alongside the two Flap networks.

## Sources

- [Flap deployments](https://docs.flap.sh/en/flap/v2/developers/deployed-contract-addresses)
- [Flap bonding-curve launch interface](https://docs.flap.sh/en/flap/v2/developers/bonding-curve/launch-tokens)
- [Uniswap V2 Base deployment](https://developers.uniswap.org/docs/protocols/v2/deployments)
- [Chainlink L2 sequencer checks](https://docs.chain.link/data-feeds/l2-sequencer-feeds)

Verification notes distinguish isolated payment-provider fixtures, read-only mainnet simulations, fork receipts and actual mainnet payments. No fixture USD receipt is published as a live payment.
