import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { id, Interface, ZeroAddress, parseEther } from 'ethers';
import { launchChain, migrateRouteChains, predictTaxToken } from '../scripts/launch-chains.mjs';
import { conversionBook, nativeStablePrice } from '../scripts/x-tax-conversions.mjs';

test('migration preserves BSC wallet derivation indexes and balances and isolates equal token addresses by chain', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE routes(idx INTEGER PRIMARY KEY,token TEXT UNIQUE,address TEXT UNIQUE,identity TEXT,ticket TEXT,lastBlock INTEGER,received TEXT DEFAULT '0',issue TEXT DEFAULT '');");
    db.prepare('INSERT INTO routes VALUES(?,?,?,?,?,?,?,?)').run(9,'same-token','old-address','ciphertext','ticket',100,'25000000000000000000','');
    migrateRouteChains(db); migrateRouteChains(db);
    assert.equal(db.prepare('SELECT * FROM routes WHERE idx=9').get().chain,56);
    assert.equal(db.prepare('SELECT * FROM routes WHERE idx=9').get().identity,'ciphertext');
    db.prepare('INSERT INTO routes(idx,chain,token,address,identity,received) VALUES(?,?,?,?,?,?)').run(10,8453,'same-token','new-address','different-ciphertext','25000000');
    assert.equal(db.prepare('SELECT received FROM routes WHERE token=? AND chain=?').get('same-token',56).received,'25000000000000000000');
    assert.equal(db.prepare('SELECT received FROM routes WHERE token=? AND chain=?').get('same-token',8453).received,'25000000');
    assert.throws(()=>db.prepare('INSERT INTO routes(idx,chain,token,address) VALUES(11,8453,?,?)').run('same-token','another'), /UNIQUE/);
    assert.notEqual(predictTaxToken(id('same salt'),56),predictTaxToken(id('same salt'),8453));
    assert.throws(()=>launchChain(1),/UNSUPPORTED_LAUNCH_CHAIN/);
  } finally {db.close();}
});
const oracle = new Interface(['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)','function decimals() view returns(uint8)']);
for (const chain of [56,8453]) test(`${chain} automatic native conversion uses oracle price, one-batch cap and chain decimals`, async () => {
  const cfg=launchChain(chain), db=new DatabaseSync(':memory:');
  let nativeAnswer=2000n*10n**8n,stableAnswer=10n**8n,updated=10000n,sequencer=0n, dexPrice=26000000n;
  const dex=new Interface(['function getAmountsOut(uint256,address[]) view returns(uint256[])','function getPair(address,address) view returns(address)']);
  const p={getNetwork:async()=>({chainId:BigInt(chain)}),getBlock:async()=>({number:200,timestamp:10020}),call:async tx=>{
    const addr=tx.to.toLowerCase(), sel=tx.data.slice(0,10);
    if(sel===oracle.getFunction('decimals').selector)return oracle.encodeFunctionResult('decimals',[8]);
    if(sel===oracle.getFunction('latestRoundData').selector){const isSeq=addr===cfg.sequencer?.toLowerCase();return oracle.encodeFunctionResult('latestRoundData',[1,isSeq?sequencer:addr===cfg.nativeUsdFeed.toLowerCase()?nativeAnswer:stableAnswer,isSeq?1:updated,updated,1]);}
    if(sel===dex.getFunction('getPair').selector)return dex.encodeFunctionResult('getPair',['0x1111111111111111111111111111111111111111']);
    const [amount,path]=dex.decodeFunctionData('getAmountsOut',tx.data);return dex.encodeFunctionResult('getAmountsOut',[[amount, amount * dexPrice * 10n**BigInt(cfg.decimals) / (parseEther('1') * 13000n)]]);
  }};
  try {
    assert.equal(await nativeStablePrice(p,cfg),2000n*10n**BigInt(cfg.decimals));
    updated=1n;await assert.rejects(nativeStablePrice(p,cfg),/ORACLE/);updated=10000n;
    stableAnswer=90_000_000n;await assert.rejects(nativeStablePrice(p,cfg),/ORACLE/);stableAnswer=100_000_000n;
    if(chain===8453){sequencer=1n;await assert.rejects(nativeStablePrice(p,cfg),/ORACLE/);sequencer=0n;}
    db.exec('CREATE TABLE routes(idx INTEGER PRIMARY KEY,chain INTEGER,token TEXT,address TEXT,received TEXT); CREATE TABLE batches(route INTEGER,stage TEXT)');
    const r={idx:0,chain,token:'0x2222222222222222222222222222222222222222',address:'0x3333333333333333333333333333333333333333'};
    db.prepare("INSERT INTO routes VALUES(0,?,?,?,'0')").run(chain,r.token,r.address);
    const book=conversionBook(db);book.register(0,{address:ZeroAddress,symbol:cfg.symbol,decimals:18},1);
    db.prepare('UPDATE poolRevenue SET earned=?').run(String(parseEther('1')));
    const limit=25n*10n**BigInt(cfg.decimals);
    dexPrice=20_000_000n; await assert.rejects(book.autoNative({p,r,minimum:limit,cap:limit}), /X_CONVERSION_PRICE/); dexPrice=26_000_000n;
    await book.autoNative({p,r,minimum:limit,cap:limit});
    const job=book.active(0);assert(job);assert(BigInt(job.floor)>=limit);assert(BigInt(job.amount)<parseEther('0.02'));assert.equal(job.kind,'dex');
    await book.autoNative({p,r,minimum:limit,cap:limit});assert.equal(book.active(0).id,job.id);
  } finally {db.close();}
});
