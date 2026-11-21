---
name: "Dark"
description: "Desktop BSC markets, Flap token issuance and tax payout tracking."
colors:
  ground: "#0b0b0b"
  chrome: "#0b0b0b"
  panel: "#151514"
  field: "#1f1f1e"
  raised: "#2a2a28"
  line: "#2a2a28"
  ink: "#f3f3f0"
  muted: "#a3a39d"
  action: "#f3f3f0"
  action-ink: "#0d0d0d"
  positive: "#67dc80"
  negative: "#ff646b"
  market-up: "#66e77b"
  market-down: "#ff5e71"
  candle-up: "#8ae4a9"
  candle-down: "#ff8996"
  film-ground: "#090909"
  film-ink: "#f5f5f5"
  ground-light: "#f7f7f5"
  chrome-light: "#fafaf8"
  panel-light: "#ffffff"
  field-light: "#efefec"
  raised-light: "#e4e4df"
  line-light: "#d6d6d0"
  ink-light: "#171715"
  muted-light: "#62625e"
  action-light: "#171715"
  action-ink-light: "#ffffff"
  positive-light: "#16743c"
  negative-light: "#b62b3d"
  market-up-light: "#19773d"
  market-down-light: "#b12037"
  candle-up-light: "#198345"
  candle-down-light: "#bb4050"
  film-ground-light: "#f5f5f5"
  film-ink-light: "#101010"
typography:
  home-title:
    fontFamily: "Archivo Black, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "56px"
    fontWeight: 400
    lineHeight: 1.04
  board-title:
    fontFamily: "Archivo Black, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "36px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.025em"
  giving-title:
    fontFamily: "Archivo Black, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "54px"
    fontWeight: 400
    lineHeight: 1
  page-title:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: "48px"
    letterSpacing: "-0.035em"
  panel-title:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "20px"
    letterSpacing: "-0.015em"
  lane-title:
    fontFamily: "Archivo Black, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "18px"
    fontWeight: 900
    lineHeight: "20px"
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  navigation:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: "20px"
  action:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "20px"
    letterSpacing: "-0.025em"
  field:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  brand:
    fontFamily: "Open Runde, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  mono:
    fontFamily: "Geist Mono Variable, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  brand-display:
    fontFamily: "Archivo Variable, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "10.8vw"
    fontWeight: 900
    lineHeight: 0.83
    letterSpacing: "-0.028em"
rounded:
  nav: "25px"
  control: "100px"
  field: "17px"
  channel: "16px"
  panel: "24px"
  giving: "28px"
spacing:
  micro: "4px"
  related: "8px"
  item: "12px"
  lanes: "16px"
  form: "20px"
  gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "0 24px"
  navigation-active:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.nav}"
    padding: "9px 15px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    height: "56px"
    padding: "0 19px"
  route-chip-selected:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.channel}"
    width: "64px"
    height: "48px"
  market-lane:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  operation-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
  giving-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.giving}"
    width: "592px"
---

# Design System: Dark

## Overview

**Creative North Star: "A clear desk for value in motion"**

Dark opens with its original monochrome particle film. The desktop workspace then uses Bags’ welcome, trade, launch and earnings layouts for four distinct tasks. The geometric D identifies Dark in both the film and the sticky header.

Home shows the configured X giving batch and the verified BSC contract count. Trade compares Flap markets by stage. Launch collects a token’s public details, beneficiary and economics in reading order. Giving starts with a choice to track a payout or select a tax beneficiary.

**Key Characteristics:**

- Centered navigation with five page links and a More tools button in a black or paper-colored header. Wallet and search controls sit to its right.
- A fine scanline texture frames solid cards with thin, low-contrast edges.
- The Trade view is wide and dense. Launch and Giving use centered single columns.
- Open Runde handles interface text. Archivo Black sets the home, market and giving display headings.

## Colors

The wallet button and selected navigation tab share a high-contrast action fill. Warm neutral surfaces step from ground to card to field. Light and dark roles are paired in the frontmatter. A subtle horizontal scan pattern is visible in the space around the solid panels. The header uses its own flat chrome surface.

Positive and negative changes use green and red with signed values. Third-party artwork keeps its own palette. The original opening film uses its own grayscale values.

**The Theme Pair Rule.** Invert the geometric D on dark chrome and preserve the original colors of token art across themes.

## Typography

Open Runde carries the wordmark, form labels, navigation, token readings and instructions. The workbench serves regular, medium, semibold and bold locally. Archivo Black provides the home and giving headlines and each Trade heading. Chinese uses PingFang SC or Microsoft YaHei according to the platform. The original About display retains Archivo Variable and its film labels retain Geist Mono. Font licenses ship with the application. [Open Runde license](public/fonts/open-runde/LICENSE.txt) · [Archivo Black license](public/fonts/archivo-black/OFL.txt)

**The Price Precision Rule.** Keep enough leading zeros to read a small price. Show the time interval and currency beside its chart.

## Layout

The desktop workspace starts at 1080px. A sticky header (66px) places the geometric D at the left, a six-item navigation capsule in the center and page-specific utilities at the right. Home, Trade and Giving show the market ticker immediately below the header. The footer contains About, Contracts, Docs, X, Tools, language and theme. At narrower desktop widths the gaps and market artwork contract.

Home centers the wallet action (320px wide) above a metrics card (520px). Trade uses a 32px ticker above the title, sorting control and three equal-width market columns. Each column scrolls independently. Search and watchlist views share the shell. Launch uses a centered 560px column with a 20px gap between form cards. Giving starts from a centered 592px card and opens a dedicated tracker or beneficiary view. Contracts and Docs retain their directory and chapter reading layouts. [Current desktop direction](docs/panels-direction.md)

## Elevation & Depth

Workspace cards use solid fills and fine edges. Active tabs reverse the foreground and background. Search, tools and charts use dismissible dialogs above the workspace. The ticker completes a loop in 86 seconds, pauses on hover or keyboard focus, and becomes stationary under reduced motion.

The opening film uses 9,000 seeded particles with two trailing samples per particle and a 6.6-second authored timeline after loading. Skip or Escape takes the visitor to Home. The site supports reduced motion and WebGL fallback, with a replay under About. [Motion specification](docs/motion-spec.md)

## Shapes

Toolbar actions and the active navigation tab are pills. Market stages and launch cards use rounded panels. The upload target is a 132px rounded square beside the stacked name and ticker fields. The description box and the public website and X inputs follow underneath. The giving card is wider with a slightly larger radius.

The 36px geometric D sits beside the Dark wordmark. Market thumbnails and submitted art identify the individual token. Missing token art falls back to an abbreviation. [Visual provenance](docs/provenance.md) · [Original D prompt](docs/logo-prompt.txt)

## Components

### Workspace navigation

Home, Launch, Trade, Giving, Docs and More tools keep the same positions across pages. The Trade view adds BSC tools to the upper right. More tools opens from the header or footer and includes watchlist, wallet payments, Agent OTC, private quotes, inventory, treasury planning, registry and activity. The Contracts link opens the separate source directory.

### Market stages and chart

The three market panels group GMGN assets into New, Soon and Bonded. New preserves the feed order. Trending ranks the current stage by available 24-hour volume. Each row presents token art, ticker, market cap and available metrics. Open a row or its Chart pill to inspect the asset. Search and feed fallback identify DEX Screener. Missing data has its own state.

Its header carries the token identity, watchlist star and close control. An actual GMGN OHLCV series drives the candlesticks in the upper pane and the USD volume histogram in a separate lower pane, sharing time at a 4:1 height ratio. Available intervals are 1m, 5m, 15m, 1h, 4h and 1d. The default is 5m. The crosshair updates O, H, L, C and volume. Source, BSC, UTC and TradingView Lightweight Charts attribution sit under the plot. The lower summary shows price, market cap, 24h volume, liquidity and the copyable contract. A missing interval, rate limit or service error has its own text and refresh action.

### Issuance and giving

Launch opens with the token identity and uploaded art, then asks who will receive trading fees. The selected channel controls the evidence field and available quote assets. Pool, tax and first purchase follow. Review discloses the recipient and signing terms. A simulated transaction, a submitted transaction and a confirmed issuance each have their own state.

Giving presents two actions. Track a payout opens the lookup by token or collection address and accepts a creation receipt when relevant. Choose a tax beneficiary opens the available paths. The tracker distinguishes confirmed BSC tax from beneficiary payment evidence. The X giving batch shown on Home comes from the service, and an unavailable value displays a dash. The contract count comes from the verified BSC deployment records. [Tax beneficiary guide](docs/private-giving.md)

## Do's and Don'ts

### Do

- Keep the notice about Dark’s official token visible on Home.
- Identify each market source and the time interval for each chart.
- Keep the wallet-signing action after review, and label beneficiary checks beside their controls.
- Preserve keyboard focus, reduced motion, first-entry skip and About replay.

### Don't

- Add mobile layouts or touch-specific controls.
- Use northeast-arrow decorations on links, buttons or signage.
- Substitute projected earnings, mock trades or unverified payments for measured values.
