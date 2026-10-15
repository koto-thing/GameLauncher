import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { checkInventory } from "../scripts/check-operator-admissions.mjs";

// 本番の権限を推測せず、検証専用のIDとロールを使う
const names=["koto-thing","momiji1107","RyotaIzumi","botamochi1111","isshi-1092","OHAYOGOMI","Aya-8","seikasan","Land-Eater","kabayaki944"];
const rows=names.map((login_snapshot,i)=>({github_user_id:i===0?"130458173":i===1?"178362923":String(700000+i),login_snapshot,role:i<2?"admin":i%2?"assistant":"executive"}));

test("migration preserves all ten operators and historical records without admitting ordinary users",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE users(github_user_id TEXT PRIMARY KEY,login_snapshot TEXT); CREATE TABLE platform_roles(github_user_id TEXT PRIMARY KEY,role TEXT,changed_by TEXT,changed_at TEXT); CREATE TABLE member_invitations(id TEXT)");
    for(const row of rows){db.prepare("INSERT INTO users VALUES (?,?)").run(row.github_user_id,row.login_snapshot);db.prepare("INSERT INTO platform_roles VALUES (?,?,'original','original')").run(row.github_user_id,row.role);}
    db.exec("INSERT INTO users VALUES('999','ordinary'); INSERT INTO platform_roles VALUES('999','user','original','original'); INSERT INTO member_invitations VALUES('historical')");
    const before=db.prepare("SELECT * FROM platform_roles ORDER BY github_user_id").all();
    const migration=readFileSync(new URL("../drizzle/0007_operator_admissions.sql",import.meta.url),"utf8");
    db.exec(migration);
    const admissions=db.prepare("SELECT * FROM operator_admissions ORDER BY github_user_id").all();
    assert.equal(admissions.length,10);
    assert.deepEqual(db.prepare("SELECT * FROM platform_roles ORDER BY github_user_id").all(),before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n,11);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM member_invitations").get().n,1);
    db.exec(migration);
    assert.deepEqual(db.prepare("SELECT * FROM operator_admissions ORDER BY github_user_id").all(),admissions);
  } finally {db.close();}
});

test("preflight fails closed on missing operators, wrong Admin role, recycled names and changed names",async()=>{
  const lookup=async login=>({id:Number(rows.find(row=>row.login_snapshot===login).github_user_id),login});
  await checkInventory(rows,lookup);
  await assert.rejects(checkInventory(rows.slice(1),lookup));
  await assert.rejects(checkInventory(rows.map(row=>({...row,role:"assistant"})),lookup));
  await assert.rejects(checkInventory(rows,async login=>({id:42,login})));
  await assert.rejects(checkInventory(rows,async login=>({...await lookup(login),login:"renamed"})));
});
