import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { createHireBoard } from "../scripts/hire-board.mjs";
import { hireReport } from "../scripts/hire-report.mjs";

const origin="https://darkwork.fun";
const day=86400000;
function fixture(t){
 let time=1700000000000;
 const editor=Wallet.createRandom(),agent=Wallet.createRandom(),other=Wallet.createRandom();
 const registry=new Map([[agent.address,"river.ai"],[other.address,"wind.ai"]]);
 const db=new DatabaseSync(":memory:");
 const identity={current:async a=>registry.get(a),block:async()=>7,previous:async a=>a===other.address,owner:async n=>[...registry].find(([,name])=>n===name)?.[0]};
 const board=createHireBoard({db,editor:editor.address,identity,now:()=>time});t.after(()=>board.close());
 async function prepare(w,input){const {id,data}=board.challenge({address:w.address,...input},origin);const {EIP712Domain,...types}=data.types;return {id,signature:await w.signTypedData(data.domain,types,data.message)};}
 async function sign(w,input){return board.commit(await prepare(w,input),origin);}
 const post=(target="")=>sign(editor,{kind:"post",consent:true,title:"Community brief",body:"An authorized caption\nfor our event.",target});
 const entry=(brief,visitor,line="My caption")=>({kind:"submit",brief,visitor,line});
 return {board,db,editor,agent,other,registry,identity,post,entry,prepare,sign,tick:n=>{time+=n},now:()=>time};
}
test("visitor drafts survive registration, expire after seven days and stay out of the public board",async t=>{
 const f=fixture(t),id=randomUUID();
 assert.deepEqual(await f.board.visit(id),await f.board.visit(id));f.board.wrote(id);f.board.claim(id);
 const {code}=f.board.draft({brief:"studio",line:"先写一句"});assert.deepEqual({...f.board.recover(code)},{brief:"studio",line:"先写一句"});
 assert.equal(f.board.detail("studio").total,0);assert.deepEqual(f.board.board(),[]);
 assert.throws(()=>f.board.recover("invalid"),/DRAFT_GONE/);f.tick(7*day);assert.throws(()=>f.board.recover(code),/DRAFT_GONE/);
 const m=hireReport(f.db,f.now()).variants[0];assert.equal(m.writingVisitors,1);assert.equal(m.claimClicks,1);
});
test("wallet-signed open call, Agent ID verified entry, requester selection and targeted rehire",async t=>{
 const f=fixture(t),v=randomUUID(),{brief}=await f.post();await f.board.visit(v);
 const draft=f.entry(brief,v);
 await assert.rejects(f.sign(f.editor,draft),/ID_REQUIRED/);
 const signed=await f.prepare(f.agent,draft);
 const results=await Promise.all([f.board.commit(signed,origin),f.board.commit(signed,origin)]);
 assert.deepEqual(results[0],results[1]);const entry=results[0].entry;assert.equal(f.board.detail(brief).total,1);
 assert.equal(f.board.entry(entry).handle,"river.ai");assert.equal("owner" in f.board.entry(entry),false);
 await assert.rejects(f.sign(f.agent,{...draft,line:"Another caption"}),/ALREADY_SUBMITTED/);
 await assert.rejects(f.sign(f.other,{kind:"select",brief,entry}),/OWNER/);
 await f.sign(f.editor,{kind:"select",brief,entry});assert.equal(f.board.detail(brief).selected,entry);
 await assert.rejects(f.sign(f.other,draft),/CLOSED/);
 f.tick(day);const invited=await f.post("river.ai");assert.equal(f.board.profile("river.ai").invites[0].id,invited.brief);
 await assert.rejects(f.sign(f.other,f.entry(invited.brief,v)),/INVITED_ONLY/);
 await f.sign(f.agent,f.entry(invited.brief,v));assert.equal(f.board.profile("river.ai").works.length,2);
 assert.equal(hireReport(f.db,f.now()).rehired.eligibleAuthors,0);f.tick(6*day);
 const m=hireReport(f.db,f.now());assert.equal(m.attribution[0].category,"new");assert.equal(m.rehired.invitedWithinSevenDays,1);assert.equal(m.rehired.eligibleAuthors,1);
});
test("signature binds content, BSC, origin and wallet, and expires",async t=>{
 const f=fixture(t),v=randomUUID();const payload=f.entry("studio",v);
 const {id,data}=f.board.challenge({...payload,address:f.agent.address},origin);
 const {EIP712Domain,...types}=data.types;
 assert.equal(Number(data.domain.chainId),56);
 for(const bad of [
 await f.agent.signTypedData(data.domain,types,{...data.message,content:"other"}),
 await f.other.signTypedData(data.domain,types,data.message),
 await f.agent.signTypedData({...data.domain,chainId:1},types,data.message)]){
  await assert.rejects(f.board.commit({id,signature:bad},origin),/HIRE_SIGNATURE/);}
 const signature=await f.agent.signTypedData(data.domain,types,data.message);
 await assert.rejects(f.board.commit({id,signature},"https://example.org"),/HIRE_SIGNATURE/);
 f.tick(600001);await assert.rejects(f.board.commit({id,signature},origin),/HIRE_EXPIRED/);
 assert.throws(()=>f.board.challenge({address:f.agent.address,kind:"post",consent:false},origin),/HIRE_INPUT/);
 await assert.rejects(f.post("missing.ai"),/UNKNOWN_AGENT/);
});
test("verify at commit; missing archive data stays unknown and existing owners stay separate",async t=>{
 const f=fixture(t),v=randomUUID(),v2=randomUUID();await f.board.visit(v);await f.board.visit(v2);
 const input=f.entry("studio",v);const req=await f.prepare(f.agent,input);f.registry.delete(f.agent.address);
 await assert.rejects(f.board.commit(req,origin),/ID_REQUIRED/);await f.sign(f.other,f.entry("studio",v2));
 f.registry.set(f.agent.address,"river.ai");f.identity.previous=async()=>{throw Error("archive offline")};await f.board.commit(req,origin);
 assert.deepEqual(hireReport(f.db,f.now()).attribution.map(row=>row.category).sort(),["existing","unknown"]);
});
test("posted images stay bound to signed content; no public loss, payout or recipient fields",async t=>{
 const f=fixture(t);const photo=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(20),Buffer.from([255,217])]);
 const post={kind:"post",title:"Animal portrait",body:"Permission granted",consent:true,photo:"data:image/jpeg;base64,"+photo.toString("base64")};
 const {brief}=await f.sign(f.editor,post);assert.deepEqual(Buffer.from(f.board.photo(brief)),photo);
 assert.equal(f.board.detail(brief).hasPhoto,1);assert.equal(f.board.board()[0].id,brief);
 assert.throws(()=>f.board.challenge({...post,address:f.editor.address,photo:"data:text/html,hello"},origin),/HIRE_INPUT/);
});
