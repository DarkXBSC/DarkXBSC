import { createHireBoard } from "./hire-board.mjs";
import { rewardReader } from "./hire-rewards.mjs";
import { hireIdentity } from "./hire-identity.mjs";
import { readFileSync } from "node:fs";

export function hireAPI(env, origin) {
  const identity = hireIdentity([
    env.X_TAX_BSC_RPC_URL,
    env.BSC_RPC_URL,
    "https://bsc-rpc.publicnode.com",
    "https://1rpc.io/bnb",
  ]);
  const board = createHireBoard({
    dir: "deployments/private/hire",
    editor: JSON.parse(readFileSync("deployments/inspection.json")).deployer,
    identity,
    rewardChain: rewardReader(env),
  });
  board.startTools(origin);
  setInterval(() => board.rewards.tick().catch(() => {}), 20000).unref();
  return async (req, res, url, { json, body, allowedOrigins }) => {
    try {
      const [, , , action, id, ...extra] = url.pathname.split("/");
      if (extra.length) return json(res, 404, { error: "HIRE_MISSING" });
      if (req.method === "GET") {
        if (action === "review-desk" && !id)
          return json(res, 200, board.portfolio.list(url.searchParams));
        if (action === "passport" && id) {
          const name = id.toLowerCase();
          if (!/^[a-z0-9][a-z0-9_-]{0,62}\.ai$/.test(name))
            throw Error("HIRE_INPUT");
          const stamp = await identity.lookup(name);
          if (!stamp) throw Error("HIRE_UNKNOWN_AGENT");
          return json(
            res,
            200,
            board.portfolio.profile(stamp, url.searchParams),
          );
        }
        if (action === "work-record" && id)
          return json(res, 200, board.portfolio.record(id, url.searchParams));
        if (action === "work-proof" && id)
          return json(res, 200, board.portfolio.proof(id));
        if (action === "services" && !id)
          return json(res, 200, board.services.list(url.searchParams));
        if (action === "service" && id)
          return json(res, 200, board.services.read(id));
        if ((action === "inbox" || action === "outbox") && id)
          return json(
            res,
            200,
            board.services.orders(
              decodeURIComponent(id),
              url.searchParams.get("before"),
              action,
            ),
          );
        if (action === "reward-info" && id)
          return json(res, 200, await board.rewards.info(id));
        if (action === "reward" && id)
          return json(res, 200, await board.rewards.sync(id));
        if (action === "reward-action" && id)
          return json(
            res,
            200,
            board.rewards.action(
              id,
              url.searchParams.get("kind"),
              url.searchParams.get("entry") || "",
            ),
          );
        if (action === "board" && !id)
          return json(res, 200, board.board(url.searchParams.get("before")));
        if (action === "brief" && id) return json(res, 200, board.detail(id));
        if (action === "work" && id) return json(res, 200, board.entry(id));
        if (action === "agent" && id) return json(res, 200, board.profile(id));
        if (action === "photo" && id) {
          const photo = board.photo(id);
          if (!photo) return json(res, 404, { error: "HIRE_MISSING" });
          res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=3600",
          });
          return res.end(Buffer.from(photo));
        }
      } else if (req.method === "POST" && !id) {
        const origin = req.headers.origin;
        if (
          !allowedOrigins.has(origin) ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          return json(res, 403, { error: "HIRE_ORIGIN" });
        let data;
        try {
          data = JSON.parse(
            await body(req, action === "challenge" ? 402000 : 2500),
          );
          if (!data || typeof data !== "object" || Array.isArray(data))
            throw Error();
        } catch {
          return json(res, 400, { error: "HIRE_INPUT" });
        }
        if (action === "visit")
          return json(res, 200, await board.visit(data.visitor));
        if (action === "wrote")
          return json(res, 200, board.wrote(data.visitor));
        if (action === "claim")
          return json(res, 200, board.claim(data.visitor));
        if (action === "draft") return json(res, 200, board.draft(data));
        if (action === "recover")
          return json(res, 200, board.recover(data.code));
        if (action === "challenge")
          return json(res, 200, await board.challenge(data, origin));
        if (action === "commit")
          return json(res, 200, await board.commit(data, origin));
      }
      return json(res, 404, { error: "HIRE_MISSING" });
    } catch (e) {
      const statuses = {
        PASSPORT_INELIGIBLE: 409,
        PASSPORT_UNLISTED: 409,
        PASSPORT_PARTY: 403,
        PASSPORT_DUPLICATE: 409,
        SERVICE_CHANGED: 409,
        SERVICE_INPUT_LINKS: 422,
        SERVICE_INPUT_TASKS: 422,
        SERVICE_ALIAS: 422,
        REWARD_TERMS: 422,
        REWARD_FACTORY: 503,
        REWARD_TOKEN: 422,
        REWARD_BALANCE: 409,
        REWARD_STATE: 409,
        REWARD_ONCHAIN: 409,
        REWARD_RPC: 503,
        HIRE_INPUT: 400,
        HIRE_MISSING: 404,
        HIRE_DRAFT_GONE: 410,
        HIRE_EXPIRED: 410,
        HIRE_SIGNATURE: 403,
        HIRE_ID_REQUIRED: 403,
        HIRE_UNKNOWN_AGENT: 422,
        HIRE_OWNER: 403,
        HIRE_CLOSED: 409,
        HIRE_INVITED_ONLY: 403,
        HIRE_ALREADY_SUBMITTED: 409,
        HIRE_BUSY: 429,
        HIRE_RPC: 503,
      };
      const status = statuses[e.message];
      return json(res, status || 500, {
        error: status ? e.message : "HIRE_UNAVAILABLE",
      });
    }
  };
}
