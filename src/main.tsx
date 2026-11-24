import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AppProvider } from "./lib/context";
import { AppFrame } from "./components/Frame";
import "./style.css";
import "./motion.css";
import "./workspace.css";
import "./bags.css";
import { MotionProvider, MotionShell } from "./lib/motion";
const Home = lazy(() => import("./pages/Home")),
  HireAgent = lazy(() => import("./pages/HireAgent")),
  Welcome = lazy(() => import("./pages/Welcome")),
  Impact = lazy(() => import("./pages/Impact")),
  XPay = lazy(() => import("./pages/XPay")),
  Market = lazy(() => import("./pages/Market")),
  Explore = lazy(() => import("./pages/Explore")),
  Launch = lazy(() => import("./pages/Launch")),
  OTC = lazy(() => import("./pages/OTC")),
  Rebalance = lazy(() => import("./pages/Rebalance")),
  Contracts = lazy(() => import("./pages/Contracts")),
  Learn = lazy(() => import("./pages/Learn")),
  Activity = lazy(() => import("./pages/Activity")),
  AgentPay = lazy(() => import("./pages/AgentPay")),
  Railgun = lazy(() => import("./pages/Railgun")),
  Admin = lazy(() => import("./pages/Admin"));
class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Unable to load this page.</h1>
        <p>页面暂时无法加载，请刷新。已广播的交易请保留哈希，不要重复提交。</p>
        <button onClick={() => location.reload()}>Reload / 刷新</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <BrowserRouter>
      <AppProvider>
        <MotionProvider>
          <MotionShell>
            <Suspense
              fallback={
                <div className="route-loading">
                  Dark <span>Loading…</span>
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Home entry />} />
                <Route path="/about" element={<Home />} />
                <Route element={<AppFrame />}>
                  <Route path="/app/home" element={<Welcome />} />
                  <Route path="/app/explore" element={<Market />} />
                  <Route path="/app/watchlist" element={<Market watchlist />} />
                  <Route path="/app/registry" element={<Explore />} />
                  <Route path="/app/launch" element={<Launch />} />
                  <Route path="/app/rebalance" element={<Rebalance />} />
                  <Route
                    path="/app/bridge"
                    element={<Navigate to="/app/rebalance" replace />}
                  />
                  <Route path="/app/railgun" element={<Railgun />} />
                  <Route path="/app/otc" element={<OTC />} />
                  <Route path="/app/agent-otc" element={<OTC agent />} />
                  <Route path="/app/agent-pay" element={<AgentPay />} />
                  <Route
                    path="/app/x-pay"
                    element={<Navigate to="/app/launch?route=x" replace />}
                  />
                  <Route path="/app/wallet-pay" element={<XPay />} />
                  <Route path="/app/hire" element={<HireAgent />} />
                  <Route path="/app/impact" element={<Impact />} />
                  <Route path="/app/contracts" element={<Contracts />} />
                  <Route path="/app/learn" element={<Learn />} />
                  <Route path="/app/activity" element={<Activity />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route
                    path="*"
                    element={
                      <div className="empty">
                        <h1>PAGE NOT FOUND.</h1>
                        <Link to="/">Return to Dark</Link>
                      </div>
                    }
                  />
                </Route>
              </Routes>
            </Suspense>
          </MotionShell>
        </MotionProvider>
      </AppProvider>
    </BrowserRouter>
  </Boundary>,
);
