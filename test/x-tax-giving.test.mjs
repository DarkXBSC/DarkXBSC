import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  Interface,
  Wallet,
  parseUnits,
  id,
  Transaction,
  keccak256,
} from "ethers";
import {
  createXTaxGiving,
  predictTaxToken,
  verifiedFiat,
} from "../scripts/x-tax-giving.mjs";
import { USDC } from "../scripts/peer-pay.mjs";
import { BSC_USDT } from "../scripts/binance-giving.mjs";

const u = (s, d = 18) => parseUnits(s, d);
const erc = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function approve(address spender,uint256 amount)",
  "function balanceOf(address) view returns(uint256)",
]);
function transfer(asset, from, to, amount) {
  return {
    address: asset,
    ...erc.encodeEventLog("Transfer", [from, to, amount]),
  };
}
test("X settlement fails closed without independent operator settings", () => {
  assert.equal(createXTaxGiving({}).enabled, false);
});
test("only proved USD for the selected X payout counts, including partial fills", () => {
  const h = id("opaque payee"),
    fill = {
      status: "FULFILLED",
      paidCurrency: "USD",
      fiatPaid: 1.51,
      paymentId: "p1",
      releasedAmount: 1510000n,
    };
  const o = {
    payouts: [{ platform: "xmoney", currency: "USD", payeeHash: h }],
    fills: [
      fill,
      fill,
      { ...fill, paymentId: "p2", status: "SIGNALED" },
      { ...fill, paymentId: "p3", paidCurrency: "EUR" },
    ],
  };
  assert.deepEqual(verifiedFiat(o, h), { cents: 151n, released: 1510000n });
  assert.throws(() => verifiedFiat(o, id("another payee")));
});
for (const chainId of [56, 8453])
for (const { viaNomination, visibility } of [
  { viaNomination: false }, { viaNomination: true },
  { viaNomination: false, visibility: "private" },
  { viaNomination: false, visibility: "public" },
  { viaNomination: true, visibility: "private" },
])
  test(
    chainId + " " + (visibility ? visibility + " disclosure: " : "") +
    (viaNomination ? "Agent ID nomination: " : "") +
      "Flap tax → cross-chain receipts → exact Base order → verified USD; restart and duplicate ticks do not pay twice",
    async (t) => {
      const dir = mkdtempSync(join(tmpdir(), "dark-x-tax-"));
      const env = {
        X_TAX_ENABLE: "yes",
        X_TAX_SEED: randomBytes(32).toString("hex"),
        X_API_BEARER_TOKEN: "fixture",
        RELAY_API_KEY: "fixture",
        X_TAX_MIN_USDT: "25",
        X_TAX_MAX_USDT: "30",
      };
      const stable = chainId === 56 ? BSC_USDT : USDC;
      const amount = v => u(v, chainId === 56 ? 18 : 6);
      const salt = id("launch salt"),
        token = predictTaxToken(salt, chainId),
        processor = Wallet.createRandom().address,
        other = Wallet.createRandom().address,
        escrow = Wallet.createRandom().address,
        payee = id("private payee");
      const impl = JSON.parse(
        readFileSync(new URL("../public/protocols.json", import.meta.url)),
      )
        .flapChains[chainId === 56 ? "bsc" : "base"].taxImplementation.slice(2)
        .toLowerCase();
      let height = 91,
        recipient,
        userId = "90001",
        bridgeCalls = 0,
        delivered = false,
        destinationReady = false,
        transfers = [],
        quotesOK = true,
        submissions = 0;
      const receiptMap = new Map();
      const bridgeIn = id("bsc"),
        bridgeOut = id("base"),
        actual = u(chainId === 56 ? "29.93" : "30", 6);
      const source = {
        getNetwork: async () => ({ chainId: 56n }),
        getBlock: async () => ({ number: height }),
        getCode: async () =>
          "0x363d3d373d3d3d363d73" + impl + "5af43d82803e903d91602b57fd5bf3",
        getLogs: async ({ fromBlock, toBlock }) =>
          transfers.filter(
            (l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
          ),
        getBalance: async () => u("0.01"),
        getTransactionReceipt: async (h) =>
          h === bridgeIn
            ? {
                from: recipient,
                status: 1,
                blockNumber: height,
                logs: [transfer(BSC_USDT, recipient, other, u("30"))],
              }
            : null,
      };
      const base = {
        getNetwork: async () => ({ chainId: 8453n }),
        getBlock: async () => ({ number: chainId === 56 ? 100 : height }),
        getLogs: source.getLogs,
        call: async () => erc.encodeFunctionResult("balanceOf", [u("33", 6)]),
        getBalance: async () => u("0.01"),
        getCode: chainId === 56 ? async () => "0x12" : source.getCode,
        getFeeData: async () => ({
          gasPrice: 100n,
          maxFeePerGas: 200n,
          maxPriorityFeePerGas: 50n,
        }),
        estimateGas: async () => 100000n,
        getTransactionCount: async () => submissions,
        getTransaction: async () => null,
        getTransactionReceipt: async (h) =>
          h === bridgeOut
            ? {
                status: 1,
                blockNumber: destinationReady ? 99 : 101,
                logs: [transfer(USDC, other, recipient, actual)],
              }
            : receiptMap.get(h),
        broadcastTransaction: async (raw) => {
          const tx = Transaction.from(raw);
          assert.equal(tx.chainId, 8453n);
          assert.equal(tx.from, recipient);
          submissions++;
          receiptMap.set(keccak256(raw), {
            status: 1,
            blockNumber: chainId === 56 ? 98 : height,
            logs: [],
          });
        },
      };
      const cash = {
        quoteSource: async ({ amount, source }) => ({
          requestId: "relay-fixture",
          inputAmount: amount,
          outputAmount: quotesOK ? (amount * 997n) / (1000n * 10n ** 12n) : 1n,
          source: { chainId: source.chainId, address: source.currency },
          destination: { chainId: 8453, address: USDC },
        }),
        executeSourceQuote: async () => {
          bridgeCalls++;
          throw Error("network response lost");
        },
        relayStatus: async (requestId) => ({
          requestId,
          status: "success",
          originChainId: 56,
          destinationChainId: 8453,
          inTxHashes: [bridgeIn],
          txHashes: [bridgeOut],
        }),
        prepare: async ({ amount, receive }) => {
          assert.equal(amount, actual);
          assert.deepEqual(receive, {
            platform: "xmoney",
            currency: "USD",
            payee: "friend",
          });
          return {
            register: { hashedOnchainIds: [payee] },
            steps: [{ kind: "approve" }, { kind: "createDeposit" }],
            txs: [
              {
                to: USDC,
                data: erc.encodeFunctionData("approve", [escrow, amount]),
                value: 0n,
                chainId: 8453,
              },
              { to: escrow, data: "0x1234", value: 0n, chainId: 8453 },
            ],
          };
        },
        finalizePreparedCashout: () => ({ depositId: "fixture-order" }),
        order: async (depositId) => ({
          depositId,
          state: delivered ? "delivered" : "awaiting-buyer",
          totalAmount: actual,
          returnedAmount: 0n,
          payouts: [{ platform: "xmoney", currency: "USD", payeeHash: payee }],
          fills: delivered
            ? [
                {
                  status: "FULFILLED",
                  paidCurrency: "USD",
                  fiatPaid: 29.92,
                  paymentId: "fiat-proof",
                  releasedAmount: actual,
                },
              ]
            : [],
        }),
      };
      const start = () =>
        createXTaxGiving(env, {
          dir,
          cash,
          bsc: source,
          base,
          processor: async () => processor,
          resolve: async () => visibility ? { id: userId, name: "Private Friend", avatar: "" } : userId,
        });
      let svc = start();
      t.after(() => {
        svc.close();
        rmSync(dir, { force: true, recursive: true });
      });
      quotesOK = false;
      if (chainId === 56) await assert.rejects(svc.check("@Friend"), /X_QUOTE_UNAVAILABLE/);
      quotesOK = true;
      const beneficiaryKey = randomBytes(32).toString("hex");
      const disclosure = visibility ? { visibility, purpose: "Animal rescue artwork" } : undefined;
      const direct = await svc.check("@Friend", undefined, disclosure, beneficiaryKey, chainId);
      let input = {
        chainId, quote: stable,
        recipient: "@Friend",
        disclosure,
        beneficiaryKey,
        ticket: direct.ticket,
        salt,
        confirmed: true,
      };
      let nomination;
      if (viaNomination) {
        const signer = Wallet.createRandom(),
          fields = {
            address: signer.address,
            recipient: "Friend",
            title: "Art for shelters",
            reason: "Volunteer posters",
            confirmed: true,
          };
        const book = svc.nominations;
        assert.throws(
          () => book.challenge({ ...fields, reason: "Help @friend" }, "local"),
          /INVALID_NOMINATION/,
        );
        let ch = book.challenge(fields, "local");
        await assert.rejects(
          book.publish(
            {
              id: ch.id,
              signature: await Wallet.createRandom().signMessage(ch.message),
            },
            async () => ({ eligible: true }),
          ),
          /INVALID_SIGNATURE/,
        );
        await assert.rejects(
          book.publish(
            { id: ch.id, signature: await signer.signMessage(ch.message) },
            async () => ({ eligible: false }),
          ),
          /AGENT_ID_REQUIRED/,
        );
        ch = book.challenge(fields, "local");
        const signed = {
          id: ch.id,
          signature: await signer.signMessage(ch.message),
        };
        const row = await book.publish(signed, async () => ({
          eligible: true,
        }));
        await assert.rejects(
          book.publish(signed, async () => ({ eligible: true })),
          /CHALLENGE_EXPIRED/,
        );
        assert.equal(row.owner, signer.address);
        assert.equal(
          JSON.stringify(book.list()).toLowerCase().includes("friend"),
          false,
        );
        nomination = row.id;
        const check = await svc.check(undefined, nomination, disclosure, beneficiaryKey, chainId);
        assert.notEqual(direct.ticket, check.ticket);
        await assert.rejects(
          svc.bind({ ...input, nomination }),
          /RECIPIENT_CHANGED/,
        );
        input = { chainId, quote: stable, nomination, disclosure, beneficiaryKey, ticket: check.ticket, salt, confirmed: true };
        userId = "90002";
        await assert.rejects(
          svc.check(undefined, nomination, disclosure, beneficiaryKey),
          /RECIPIENT_CHANGED/,
        );
        userId = "90001";
      }
      await assert.rejects(
        svc.bind({ ...input, confirmed: false }),
        /RECIPIENT_CHANGED/,
      );
      if (disclosure) {
        await assert.rejects(svc.bind({ ...input, disclosure: { ...disclosure, purpose: "Changed" } }), /RECIPIENT_CHANGED/);
      }
      await assert.rejects(svc.bind({...input, chainId: chainId === 56 ? 8453 : 56}), /RECIPIENT_CHANGED/);
      const route = await svc.bind(input);
      if (nomination) {
        assert.deepEqual(svc.nominations.detail(nomination).receipts, []);
        await assert.rejects(
          svc.bind({
            recipient: "Friend",
            ticket: direct.ticket,
            salt,
            confirmed: true,
          }),
          /RECIPIENT_CHANGED/,
        );
      }
      if (disclosure) {
        const guessedKey = randomBytes(32).toString("hex");
        const guessed = await svc.check(input.recipient, nomination, disclosure, guessedKey);
        await assert.rejects(svc.bind({ ...input, beneficiaryKey: guessedKey, ticket: guessed.ticket }), /RECIPIENT_CHANGED/);
        assert.equal(JSON.stringify(svc.status(token, chainId)).includes(beneficiaryKey), false);
      }
      recipient = route.address;
      assert.equal(route.token, token);
      assert.equal((await svc.bind(input)).address, recipient);
      assert.equal(
        readFileSync(join(dir, "routes.sqlite")).includes(
          Buffer.from("friend"),
        ),
        false,
      );
      assert.equal(JSON.stringify(svc.status(token, chainId)).includes("friend"), visibility === "public");
      if (visibility) assert.equal(svc.status(token, chainId).disclosure.visibility, visibility);
      height++;
      transfers = [
        {
          ...transfer(stable, other, recipient, amount("999")),
          blockNumber: height,
        },
        {
          ...transfer(stable, processor, recipient, amount("33")),
          blockNumber: height,
        },
      ];
      userId = "90002";
      await svc.tick();
      assert.equal(svc.status(token, chainId).issue, "X_ACCOUNT_CHANGED");
      assert.equal(bridgeCalls, 0);
      assert.equal(svc.status(token, chainId).received, "33.0");
      userId = "90001";
      await Promise.all([svc.tick(), svc.tick()]);
      assert.equal(bridgeCalls, chainId === 56 ? 1 : 0);
      svc.close();
      svc = start();
      if (chainId === 56) {
        await svc.tick();
        assert.equal(svc.status(token, chainId).stage, "bridge");
        destinationReady = true;
        await svc.tick();
      }
      assert.equal(svc.status(token, chainId).stage, "base");
      await svc.tick();
      assert.equal(svc.status(token, chainId).stage, "approve");
      for (let i = 0; i < 8; i++) await svc.tick();
      assert.equal(submissions, 2);
      assert.equal(svc.status(token, chainId).stage, "matching");
      assert.equal(svc.status(token, chainId).paid, "0.0");
      delivered = true;
      await svc.tick();
      await svc.tick();
      assert.equal(svc.status(token, chainId).stage, "paid");
      assert.equal(svc.status(token, chainId).paid, "29.92");
      if (nomination)
        assert.equal(
          svc.nominations.list(0, svc.nominations.detail(nomination).owner)
            .paidBeneficiaries,
          1,
        );
      if (nomination)
        assert.deepEqual(svc.nominations.detail(nomination).receipts, [
          { token, chainId, stage: "paid", paidCents: "2992" },
        ]);
      assert.equal(bridgeCalls, chainId === 56 ? 1 : 0);
    },
  );
