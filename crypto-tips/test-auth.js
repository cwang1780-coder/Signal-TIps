// Run: node test-auth.js  — checks who may call the private endpoints when running on Vercel.
const assert = require("assert");
const { execFileSync } = require("child_process");

if (process.argv[2] === "child") {
  const http = require("http");
  const { holdingsHandler, askHandler } = require("./handlers.js");
  const srv = http.createServer((req, res) => (req.url.startsWith("/api/ask") ? askHandler : holdingsHandler)(req, res));
  srv.listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const out = {};
    for (const [name, pw] of [["none", null], ["wrong", "nope"], ["right", "correct horse"]]) {
      const h = pw ? { "X-App-Password": pw } : {};
      out[name + "Holdings"] = (await fetch(base + "/api/coinbase/holdings", { headers: h })).status;
      out[name + "Ask"] = (await fetch(base + "/api/ask", { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: "{}" })).status;
    }
    console.log(JSON.stringify(out));
    process.exit(0);
  });
  return;
}

const run = (env) => JSON.parse(execFileSync(process.execPath, [__filename, "child"], { env: { ...process.env, ...env }, encoding: "utf8" }).trim().split("\n").pop());

// Online without a password: private endpoints are switched off.
const off = run({ VERCEL: "1", APP_PASSWORD: "" });
assert.strictEqual(off.rightHoldings, 503);
assert.strictEqual(off.rightAsk, 402); // Ask AI is Pro: visitors are pointed to the trial

// Online with a password: only the right password gets through (400 = reached the handler, body was empty).
const on = run({ VERCEL: "1", APP_PASSWORD: "correct horse" });
assert.deepStrictEqual([on.noneHoldings, on.wrongHoldings, on.rightHoldings], [401, 401, 200]);
assert.deepStrictEqual([on.noneAsk, on.wrongAsk, on.rightAsk], [402, 402, 400]); // owner password still works

console.log("auth tests passed");
