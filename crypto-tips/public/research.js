// Research: market mood bar, extra reasons for and against, what history says, similar past patterns, news.
// Everything here is context to weigh. None of it changes the signal score (see README → Research).
// Uses globals from app.js: results, selected, $, fmt, pct, coinName, trackRecord, fetchPage, API.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const p0 = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(0) + "%";
  const p1 = (n) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  const gran = () => +$("tf").value;
  const UNIT = { 86400: ["day", "days"], 21600: ["6-hour candle", "6-hour candles"], 3600: ["hour", "hours"] };
  const units = (n) => `${n} ${UNIT[gran()][n === 1 ? 0 : 1]}`;
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; };

  // ── data ──
  const research = {};   // sym (or "") -> {at, data}
  const deep = {};       // "SYM:gran" -> candles (up to ~2,400) for history searches
  const loading = new Set();

  async function loadResearch(sym) {
    const key = sym || "";
    if (location.protocol === "file:" || loading.has("r" + key) || (research[key] && Date.now() - research[key].at < 10 * 60000)) return;
    loading.add("r" + key);
    try {
      const res = await fetch(`/api/research?coin=${encodeURIComponent(key)}&name=${encodeURIComponent(coinName(key))}`);
      if (res.ok) { research[key] = { at: Date.now(), data: await res.json() }; if (!research[""]) research[""] = research[key]; }
    } catch {}
    loading.delete("r" + key);
    renderMarket(); renderTopNews();
    if (selected === sym) renderResearch(sym);
  }

  // Older price history for the selected coin only, so pattern searches have years to look through.
  async function loadDeep(sym) {
    const key = sym + ":" + gran(), base = results[sym]?.candles;
    if (!base || deep[key] || loading.has("d" + key)) return;
    loading.add("d" + key);
    const map = new Map(base.map((c) => [c.time, c]));
    let end = base[0].time;
    for (let k = 0; k < 5; k++) {
      try {
        const older = await fetchPage(sym, gran(), end - gran());
        if (!older.length) break;
        older.forEach((c) => map.set(c.time, c));
        end = older[0].time;
      } catch { break; }
    }
    deep[key] = [...map.values()].sort((a, b) => a.time - b.time);
    loading.delete("d" + key);
    if (selected === sym) renderResearch(sym);
  }
  // Deep history with the newest candles from the live data merged in.
  function history(sym) {
    const d = deep[sym + ":" + gran()], live = results[sym]?.candles;
    if (!live) return null;
    if (!d) return live;
    const map = new Map(d.map((c) => [c.time, c]));
    live.forEach((c) => map.set(c.time, c));
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  // ── market bar (Signals tab) ──
  function moodClass(v) { return v <= 25 ? "down" : v >= 75 ? "up" : ""; }
  function renderMarket() {
    const d = research[""]?.data, el = $("marketBar");
    if (!d || (!d.fearGreed && !d.global)) { el.hidden = true; return; }
    el.hidden = false;
    const f = d.fearGreed, g = d.global, parts = [];
    if (f?.value != null) parts.push(`<span title="The Fear &amp; Greed index: 0 is extreme fear, 100 is extreme greed. A week ago it was ${f.weekAgo ?? "?"}.">Market mood <b class="${moodClass(f.value)}">${esc(f.label)} · ${f.value}/100</b></span>`);
    if (g?.marketCapUsd) parts.push(`<span title="The combined value of all cryptocurrencies">All crypto <b>${Currency.compact(g.marketCapUsd)}</b>${g.change24hPct != null ? ` <b class="${g.change24hPct >= 0 ? "up" : "down"}">${g.change24hPct >= 0 ? "+" : ""}${g.change24hPct}% today</b>` : ""}</span>`);
    if (g?.btcDominancePct != null) parts.push(`<span title="Bitcoin's share of the whole crypto market. A rising share usually means money is leaving smaller coins.">Bitcoin's share <b>${g.btcDominancePct}%</b></span>`);
    el.innerHTML = parts.join("");
  }

  function newsList(items) {
    return `<ul class="news">${items.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.source)} · ${ago(n.time)}</span></li>`).join("")}</ul>`;
  }
  function renderTopNews() {
    const top = research[""]?.data?.news?.top;
    $("topNews").innerHTML = top?.length ? `<h2>Top crypto headlines</h2><div class="panel">${newsList(top)}<p class="muted" style="margin-top:6px">Headlines from Cointelegraph and Decrypt. Tap to read the full story on their site.</p></div>` : "";
  }

  // ── more reasons for and against ──
  function reasons(sym) {
    const r = results[sym], out = [];
    const add = (side, title, text) => out.push({ side, title, text });
    const c = r.candles, price = r.price;
    const btc = results.BTC;

    if (sym !== "BTC" && btc && !btc.error) {
      if (btc.action.includes("SELL")) add("against", "Bitcoin is in a downtrend", "Most coins follow Bitcoin. When it falls, smaller coins usually fall harder.");
      else if (btc.action.includes("BUY")) add("for", "Bitcoin is in an uptrend", "Most coins follow Bitcoin, so a rising Bitcoin is a tailwind.");
      else add("neutral", "Bitcoin is undecided", "Most coins follow Bitcoin, and right now it has no clear direction.");
      const n = Math.min(90, c.length - 1, btc.candles.length - 1);
      const rel = c[c.length - 1].close / c[c.length - 1 - n].close - btc.candles[btc.candles.length - 1].close / btc.candles[btc.candles.length - 1 - n].close;
      if (rel > 0.05) add("for", `Stronger than Bitcoin lately`, `Over the last ${units(n)} it did ${p0(rel)} better than Bitcoin. Coins that lead tend to keep getting attention.`);
      else if (rel < -0.05) add("against", `Weaker than Bitcoin lately`, `Over the last ${units(n)} it did ${p0(rel)} versus Bitcoin. Money has been moving away from it.`);
    }

    const yr = c.slice(-Math.min(c.length, Math.round((365 * 86400) / gran())));
    const hi = Math.max(...yr.map((x) => x.close)), lo = Math.min(...yr.map((x) => x.close));
    const fromHi = price / hi - 1, span = gran() === 86400 ? "1-year" : "recent";
    if (fromHi > -0.1) add("for", `Near its ${span} high`, `Only ${p0(fromHi)} from the top of its ${span} range (${fmt(hi)}). Strength tends to continue, though buying right at a high can mean a wait.`);
    else if (fromHi < -0.5) add("against", `Down ${Math.round(-fromHi * 100)}% from its ${span} high`, `It peaked at ${fmt(hi)}. A big discount is not the same as good value: coins that fall this far often keep falling.`);
    else add("neutral", `${Math.round(-fromHi * 100)}% below its ${span} high`, `Range over that time: ${fmt(lo)} to ${fmt(hi)}.`);

    const lv = Indicators.levels(c);
    if (lv.support || lv.resistance) {
      const bits = [];
      if (lv.support) bits.push(`nearest floor ${fmt(lv.support)} (${p1(lv.support / price - 1)})`);
      if (lv.resistance) bits.push(`nearest ceiling ${fmt(lv.resistance)} (${p1(lv.resistance / price - 1)})`);
      const nearFloor = lv.support && price / lv.support - 1 < 0.03;
      add("neutral", nearFloor ? "Sitting just above a price floor" : "Price floors and ceilings",
        `${bits.join(", ")}. These are levels where the price turned around before. ${nearFloor ? "Buyers stepped in here last time; if it breaks below, that is a warning sign." : "Traders watch them for bounces and breakouts."} You can draw them on the chart and set an alert.`);
    }

    const mv = Indicators.typicalMove(c);
    if (mv != null) {
      const btcMv = btc?.candles ? Indicators.typicalMove(btc.candles) : null;
      const ratio = sym !== "BTC" && btcMv ? mv / btcMv : null;
      add(ratio && ratio >= 2 ? "against" : "neutral", ratio && ratio >= 2 ? "Much jumpier than Bitcoin" : "How much it swings",
        `A typical move is ±${(mv * 100).toFixed(1)}% per ${UNIT[gran()][0]}${ratio ? `, about ${ratio.toFixed(1)}× Bitcoin's` : ""}. Bigger swings mean bigger losses when you're wrong, so smaller positions make sense.`);
    }

    const s = window.socialSnapshot?.().coins?.[sym];
    if (s && !s.error && s.bullishPct != null) {
      if (["high", "very high"].includes(s.hype) && s.bullishPct >= 85) add("against", "The crowd is extremely bullish", `${s.bullishPct}% of tagged posts are bullish and hype is ${s.hype}. When almost everyone already agrees, there are fewer buyers left to push it higher.`);
      else if (s.bullishPct <= 35) add("neutral", "The crowd is gloomy", `Only ${s.bullishPct}% of tagged posts are bullish. Some traders read that as a contrarian sign, but on its own it has not been reliable.`);
      else add("neutral", "What the crowd thinks", `${s.bullishPct}% of tagged posts are bullish, hype is ${s.hype}. See the Buzz tab for the posts.`);
    }

    const m = research[""]?.data;
    if (m?.global?.change24hPct != null && Math.abs(m.global.change24hPct) >= 3)
      add(m.global.change24hPct > 0 ? "for" : "against", `The whole market is ${m.global.change24hPct > 0 ? "up" : "down"} ${Math.abs(m.global.change24hPct)}% today`, "Big market-wide days carry most coins with them, whatever their own story is.");
    if (m?.fearGreed?.value != null)
      add("neutral", `Market mood: ${m.fearGreed.label} (${m.fearGreed.value}/100)`, `A week ago it was ${m.fearGreed.weekAgo ?? "?"}. People often say "buy when others are fearful", but when we checked 2018 to 2026, Bitcoin's next 30 days were up 57% of the time after extreme fear versus 54% on any ordinary day. Mood alone has not been a reliable signal.`);

    const bt = trackRecord(sym, c);
    if (bt && bt.trades + (bt.openTrade != null ? 1 : 0) > 0) {
      const d = bt.strategyReturn - bt.holdReturn;
      if (d > 0.05) add("for", "The signals have worked on this coin", `On this chart, following them did ${Math.round(d * 100)} points better than holding. Past results do not predict future results.`);
      else if (d < -0.05) add("against", "The signals have not worked well on this coin", `On this chart, following them did ${Math.round(-d * 100)} points worse than holding. Give the signal less weight here.`);
    }
    return out;
  }

  function reasonsHtml(sym) {
    const all = reasons(sym);
    const col = (side, title, cls) => {
      const items = all.filter((x) => x.side === side);
      return `<div class="rcol ${cls}"><h3>${title} <span class="muted">${items.length}</span></h3>${items.length ? items.map((x) => `<div class="reason"><b>${esc(x.title)}</b><span>${x.text}</span></div>`).join("") : `<div class="muted">Nothing stands out right now.</div>`}</div>`;
    };
    return `<h2 id="d-reasons">More to weigh <span class="muted">other reasons people buy or sell. These don't change the signal score.</span></h2>
      <div class="rgrid">${col("for", icon("up") + " Reasons for", "rfor")}${col("against", icon("down") + " Reasons against", "ragainst")}${col("neutral", icon("search") + " Worth knowing", "rneutral")}</div>`;
  }

  // ── why it's moving: is it doing well, badly or just mid, and what's behind it ──
  // Splits the coin's week into the part the whole market explains (via Bitcoin and how closely the coin
  // usually follows it) and the coin's own part, then lists the clues: volume, breakouts, trend, news, buzz.
  const DAY = 86400;
  function idxAt(c, t) { let i = c.length - 1; while (i > 0 && c[i].time > t) i--; return i; }
  function changeOver(c, secs) {
    const last = c[c.length - 1], i = idxAt(c, last.time - secs);
    return last.time - c[i].time >= secs * 0.7 ? last.close / c[i].close - 1 : null;
  }
  // How strongly the coin has moved with Bitcoin (beta) over its last 90 shared candles.
  function betaVsBtc(c, b) {
    const bm = new Map(b.map((x) => [x.time, x.close])), xs = [], ys = [];
    for (let i = Math.max(1, c.length - 90); i < c.length; i++) {
      const b0 = bm.get(c[i - 1].time), b1 = bm.get(c[i].time);
      if (b0 && b1) { xs.push(b1 / b0 - 1); ys.push(c[i].close / c[i - 1].close - 1); }
    }
    if (xs.length < 20) return null;
    const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
    let cov = 0, vx = 0, vy = 0;
    xs.forEach((x, i) => { cov += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; });
    return vx ? { beta: cov / vx, corr: cov / Math.sqrt(vx * vy || 1) } : null;
  }
  // Dollar volume per second over [from, to) seconds ago.
  function dollarVol(c, from, to) {
    const now = c[c.length - 1].time; let sum = 0, t0 = Infinity, t1 = 0;
    for (const x of c) if (x.time > now - from && x.time <= now - to) { sum += (x.volume || 0) * x.close; t0 = Math.min(t0, x.time); t1 = Math.max(t1, x.time); }
    return t1 > t0 ? sum / (t1 - t0 + gran()) : null;
  }

  function moveInfo(sym) {
    const r = results[sym];
    if (!r || r.error) return null;
    const c = history(sym) || r.candles, name = coinName(sym) || sym, btc = results.BTC;
    const d1 = changeOver(c, DAY), w = changeOver(c, 7 * DAY), m = changeOver(c, 30 * DAY);
    if (w == null) return null;
    let verdict = "mid";
    if (w >= 0.05 || (m != null && m >= 0.15 && w > -0.03)) verdict = "good";
    if (w <= -0.05 || (m != null && m <= -0.15 && w < 0.03)) verdict = verdict === "good" ? (w > 0 ? "good" : "bad") : "bad";
    const twist = verdict === "good" && m != null && m <= -0.1 ? "bouncing back after a rough month"
      : verdict === "bad" && m != null && m >= 0.1 ? "pulling back after a strong month" : "";

    const drivers = [], add = (dir, title, text) => drivers.push({ dir, title, text });
    let cause = "";
    // 1) The whole market (through Bitcoin)
    if (sym !== "BTC" && btc && !btc.error) {
      const bw = changeOver(btc.candles, 7 * DAY), bt = betaVsBtc(c, btc.candles);
      if (bw != null && bt) {
        const beta = Math.max(0, bt.beta), expected = beta * bw, own = w - expected;
        const tight = bt.corr >= 0.6 ? "closely" : bt.corr >= 0.35 ? "loosely" : "barely";
        add(bw >= 0.02 ? "up" : bw <= -0.02 ? "down" : "flat", `Bitcoin ${p1(bw)} this week`,
          `${esc(name)} ${tight} follows Bitcoin, usually moving about ${beta.toFixed(1)}× as much. So the whole market alone would explain roughly <b>${p1(expected)}</b> of its <b>${p1(w)}</b>.`);
        if (Math.abs(own) >= 0.03) add(own > 0 ? "up" : "down", `Its own story: ${p1(own)}`, own > 0
          ? (w >= 0 ? `It did better than the market explains. Something specific to ${esc(name)} is pulling buyers in: look at the volume, news and buzz below.` : `It held up better than the market explains, so buyers are still supporting it. The clues below may show why.`)
          : (w < 0 ? `It did worse than the market explains. Something specific to ${esc(name)} is pushing people to sell: look at the volume, news and buzz below.` : `It rose less than the market explains, so it's lagging. The clues below may show why.`));
        cause = Math.abs(w) < 0.02 ? "" : Math.sign(expected) === Math.sign(w) && Math.abs(expected) >= 0.6 * Math.abs(w)
          ? "Mostly the whole market: it's moving with Bitcoin." : Math.abs(own) > Math.abs(expected) ? `Mostly its own story, not the market.` : "A mix of the market and its own story.";
      }
    } else {
      const g = research[""]?.data?.global;
      if (g?.change24hPct != null && Math.abs(w) >= 0.02) cause = `Bitcoin leads the market, and all of crypto is ${g.change24hPct >= 0 ? "up" : "down"} ${Math.abs(g.change24hPct)}% today.`;
      if (g?.change24hPct != null) add(g.change24hPct >= 1 ? "up" : g.change24hPct <= -1 ? "down" : "flat", `All of crypto ${g.change24hPct >= 0 ? "+" : ""}${g.change24hPct}% today`, "Bitcoin is the market leader, so its moves and the whole market's usually go together. Big swings often come from economic news (interest rates, inflation), ETF money flowing in or out, or large holders selling.");
    }
    // 2) Trading volume: are more people piling in or out?
    const vNow = dollarVol(c, 7 * DAY, 0), vBefore = dollarVol(c, 37 * DAY, 7 * DAY);
    if (vNow && vBefore) {
      const ratio = vNow / vBefore;
      if (ratio >= 1.5) add(w >= 0 ? "up" : "down", `Trading is ${ratio.toFixed(1)}× busier than usual`, w >= 0
        ? "Lots more money is changing hands while the price rises: real demand is showing up. Moves backed by heavy volume tend to mean more."
        : "Lots more money is changing hands while the price falls: that's heavy selling, not just a quiet drift.");
      else if (ratio <= 0.6) add("flat", "Quiet trading", `Volume is about ${Math.round((1 - ratio) * 100)}% below normal. Moves on thin trading often fade, in either direction.`);
      else add("flat", "Normal trading volume", "Nothing unusual about how much is being traded, so there's no sign of a rush in or out.");
    }
    // 3) Breakouts and breakdowns
    const prev = c.filter((x) => x.time < c[c.length - 1].time - 2 * DAY && x.time >= c[c.length - 1].time - 32 * DAY);
    if (prev.length > 5) {
      const hi = Math.max(...prev.map((x) => x.close)), lo = Math.min(...prev.map((x) => x.close)), px = r.price;
      if (px > hi) add("up", `Broke above its 30-day high (${fmt(hi)})`, "New highs get noticed: traders who were waiting for a breakout buy, and people who were short buy back. That can feed the move.");
      else if (px < lo) add("down", `Fell below its 30-day low (${fmt(lo)})`, "New lows trigger stop-losses and scare holders into selling, which can feed the drop.");
    }
    // 4) The long-term trend
    if (c.length >= 200) {
      const avg = c.slice(-200).reduce((a, x) => a + x.close, 0) / 200;
      add(r.price >= avg ? "up" : "down", r.price >= avg ? "Long-term trend is up" : "Long-term trend is down",
        `The price is ${p0(r.price / avg - 1)} ${r.price >= avg ? "above" : "versus"} its 200-period average. ${r.price >= avg ? "Coins in an uptrend attract buyers on dips." : "In a downtrend, rallies often get sold by people waiting to get out."}`);
    }
    // 5) News
    const news = (research[sym]?.data?.news?.coin || []).filter((n) => Date.now() - n.time < 4 * DAY * 1000).slice(0, 3);
    if (news.length) add("news", `In the news (${news.length})`, news.map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.source)} · ${ago(n.time)}</span>`).join("<br>"));
    else if (research[sym]) add("flat", "No big news", "No headlines in our news sources mention it in the last 4 days, so news doesn't look like the driver.");
    // 6) Social buzz and trending
    const s = window.socialSnapshot?.().coins?.[sym], tr = window.trenchSnapshot?.()?.movers?.find((x) => x.sym === sym);
    if (s && !s.error && s.hype) add(["high", "very high"].includes(s.hype) ? "news" : "flat", `Social buzz: ${s.hype}`,
      `${s.bullishPct != null ? s.bullishPct + "% of tagged posts are bullish. " : ""}${["high", "very high"].includes(s.hype) ? "People are talking about it a lot, which brings in new buyers fast, and can leave just as fast." : "Not much chatter, so hype isn't the driver."}`);
    if (tr?.trending) add("news", `Trending #${tr.trending} in searches`, "Lots of people are looking it up on CoinGecko right now. Attention like this often comes before or during a big move.");

    return { sym, name, d1, w, m, verdict, twist, cause, drivers };
  }

  function moveHtml(sym) {
    const i = moveInfo(sym);
    if (!i) return "";
    const V = { good: ['<span class="vdot up"></span>', "Doing well", "up"], bad: ['<span class="vdot down"></span>', "Doing badly", "down"], mid: ['<span class="vdot"></span>', "Just mid", ""] }[i.verdict];
    const chip = (label, v) => v == null ? "" : `<span class="mchip"><span class="muted">${label}</span><b class="${v >= 0 ? "up" : "down"}">${p1(v)}</b></span>`;
    const ICON = { up: "▲", down: "▼", flat: "•", news: icon("news") };
    return `<section class="move ${V[2] ? "move-" + V[2] : ""}"><h2 id="d-move">${V[0]} ${V[1]}${i.twist ? ` <span class="muted">· ${i.twist}</span>` : ""}</h2>
      <p class="move-sum">${esc(i.name)} is <b class="${i.w >= 0 ? "up" : "down"}">${p1(i.w)}</b> this week${i.m != null ? ` and <b class="${i.m >= 0 ? "up" : "down"}">${p1(i.m)}</b> this month` : ""}. ${i.cause || (i.verdict === "mid" ? "Not much is happening either way." : "")}</p>
      <div class="mchips">${chip("24 hours", i.d1)}${chip("7 days", i.w)}${chip("30 days", i.m)}</div>
      <h3 class="subh">What's behind it</h3>
      <ul class="drivers">${i.drivers.map((d) => `<li class="drv-${d.dir}"><span class="drv-ic">${ICON[d.dir]}</span><span><b>${d.title}</b><span>${d.text}</span></span></li>`).join("")}</ul>
      <p class="muted small">This explains the recent move from price, volume, news and social data. It describes what happened, not what happens next.</p></section>`;
  }

  // ── chart pattern: what it is, and what followed it in the past ──
  let patternStudy = null;
  if (location.protocol !== "file:") fetch("pattern-stats.json").then((r) => (r.ok ? r.json() : null)).then((d) => { patternStudy = d; if (selected) renderResearch(selected); }).catch(() => {});

  // A lean only counts if it's clearly away from an ordinary day AND points the same way in both halves of the study.
  function leanOf(p, base) {
    if (!p || !base || p.n < 30) return "none";
    const d = p.up - base.up, d1 = p.halves[0].up - base.halves[0].up, d2 = p.halves[1].up - base.halves[1].up;
    if (d >= 0.06 && d1 >= 0.03 && d2 >= 0.03) return "up";
    if (d <= -0.06 && d1 <= -0.03 && d2 <= -0.03) return "down";
    return "none";
  }

  function patternInfo(sym) {
    const h = history(sym);
    if (!h || h.length < 120) return null;
    const pat = Indicators.detectPattern(h);
    const horizon = 30;
    const own = Indicators.patternStats(Indicators.patternHistory(h, { horizon }), pat.id);
    const study = patternStudy && gran() === 86400 ? patternStudy : null;
    const p = study?.patterns[pat.id] || null;
    return { pat, own, horizon, study, p, lean: leanOf(p, study?.baseline), years: ((h[h.length - 1].time - h[0].time) / (365 * 86400)).toFixed(1) };
  }

  function patternHtml(sym) {
    const info = patternInfo(sym);
    if (!info) return "";
    const { pat, own, horizon, study, p, lean } = info, name = esc(coinName(sym) || sym);
    const pro = window.userLevel?.() === "pro";
    const biasTxt = { up: "Traders usually read it as bullish (up)", down: "Traders usually read it as bearish (down)", neutral: "Traders don't expect a direction from it" }[pat.bias];
    const pc = (x) => Math.round(x * 100) + "%";
    let html = `<h2 id="d-pattern">Chart pattern <span class="muted">what shape the price is in, and what happened after it before</span></h2>
      <div class="pattern"><div class="pattern-head"><span class="pattern-name">${esc(pat.name)}</span>
      <span class="badge ${pat.bias === "up" ? "b-BUY" : pat.bias === "down" ? "b-SELL" : "b-HOLD"}">${biasTxt}</span></div>
      <p>${esc(pat.text)}</p>`;
    if (pat.id === "none") return html + `<p class="muted">Without a recognisable pattern there's nothing to compare with history right now.</p></div>`;

    if (study && p) {
      const verdict = lean === "up" ? `<b class="up">History leans up.</b> After this pattern, prices were higher 30 days later more often than on an ordinary day.`
        : lean === "down" ? `<b class="down">History leans down.</b> After this pattern, prices were lower 30 days later more often than on an ordinary day.`
        : `<b>No clear lean.</b> After this pattern, prices went up about as often as on any ordinary day, so it hasn't been a useful predictor.`;
      const contra = (pat.bias === "up" && lean === "down") || (pat.bias === "down" && lean === "up")
        ? `<p class="warn">${icon("alert")} Traders call this pattern ${pat.bias === "up" ? "bullish" : "bearish"}, but in our data the opposite happened more often.</p>` : "";
      html += `<div class="verdict">${verdict}</div>${contra}
        <div class="stats setup">
          <div><span class="muted">Price higher 30 days later</span><b>${pc(p.up)}</b><span class="muted">of ${p.n} times this pattern appeared</span></div>
          <div><span class="muted">On an ordinary day</span><b>${pc(study.baseline.up)}</b><span class="muted">for comparison</span></div>
          <div><span class="muted">Typical 30-day move after it</span><b class="${p.median >= 0 ? "up" : "down"}">${p.median >= 0 ? "+" : ""}${(p.median * 100).toFixed(1)}%</b><span class="muted">middle result</span></div>
        </div>
        <p class="muted" style="margin-top:8px">We studied ${study.coins.length} major coins on daily charts from ${study.from} to ${study.to}${pro ? `. First half of that period: higher ${pc(p.halves[0].up)} of the time (ordinary day ${pc(study.baseline.halves[0].up)}); second half: ${pc(p.halves[1].up)} (ordinary day ${pc(study.baseline.halves[1].up)})` : ""}.</p>`;
    } else if (gran() !== 86400) {
      html += `<p class="muted">The 10-coin study uses daily charts. Switch the view to long-term to see it.</p>`;
    }
    html += own.n
      ? `<p><b>In ${name}'s own history</b> (${info.years} years on this chart): seen ${own.n} time${own.n === 1 ? "" : "s"}, and the price was higher ${horizon} candles later ${pc(own.up)} of the time${own.n < 10 ? ". That's too few cases to rely on" : ""}.</p>`
      : `<p class="muted">${name} hasn't shown this pattern before on this chart.</p>`;
    return html + `<p class="muted small">Chart patterns are spotted automatically and traders often disagree on them. Past results don't predict the future.</p></div>`;
  }

  // ── what history says ──
  function spark(path, split) {
    const W = 150, H = 46, min = Math.min(...path), max = Math.max(...path);
    const X = (i) => (i / (path.length - 1)) * W, Y = (v) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
    const pts = (a, off) => a.map((v, i) => `${X(i + off).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const up = path[path.length - 1] >= path[split - 1];
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Price pattern and what followed">
      <polyline points="${pts(path.slice(0, split), 0)}" fill="none" stroke="#9aa1ad" stroke-width="1.5"/>
      <polyline points="${pts(path.slice(split - 1), split - 1)}" fill="none" stroke="${up ? "#098551" : "#cf202f"}" stroke-width="2"/>
      <circle cx="${X(split - 1).toFixed(1)}" cy="${Y(path[split - 1]).toFixed(1)}" r="2.5" fill="#0a0b0d"/></svg>`;
  }

  // Say what this coin's own history shows, whichever way it points.
  function setupVerdict(sh) {
    if (!sh.up.n || !sh.down.n) return "It has spent this whole period on one side of its average, so there is nothing to compare.";
    const d = sh.up.median - sh.down.median;
    if (d >= 0.03) return "In this coin's history, the weeks after it was above its long-term average went better than the weeks after it was below. That fits the trend idea behind the signal.";
    if (d <= -0.03) return "In this coin's history, the weeks after it was below its long-term average actually went better. That is the opposite of the trend idea behind the signal, so give the signal less weight for this coin over this timespan.";
    return "In this coin's history, the next stretch looked about the same either way. The trend signal's edge in our tests came from avoiding the long slides, not from every short stretch.";
  }

  function historyHtml(sym) {
    const h = history(sym), name = coinName(sym) || sym;
    if (!h) return "";
    const key = sym + ":" + gran(), stillLoading = !deep[key];
    const years = ((h[h.length - 1].time - h[0].time) / (365 * 86400));
    const span = years >= 1 ? `${years.toFixed(1)} years` : `${Math.round(years * 365)} days`;
    let html = `<h2 id="d-history">What history says <span class="muted">searching ${span} of ${esc(name)}'s prices${stillLoading ? " (loading more…)" : ""}</span></h2>`;

    const sh = Indicators.setupHistory(h, 30);
    if (sh) {
      const row = (k, label) => `<div class="${sh.now === k ? "nowrow" : ""}"><span class="muted">${label}${sh.now === k ? " <b>(like now)</b>" : ""}</span>
        <b class="${sh[k].median >= 0 ? "up" : "down"}">${sh[k].n ? p0(sh[k].median) : "–"}</b><span class="muted">${sh[k].n ? `typical move over the next ${units(30)} · up ${Math.round(sh[k].pctUp * 100)}% of the time` : "never happened in this period"}</span></div>`;
      html += `<div class="stats setup">${row("up", "When it was above its 200-period average")}${row("down", "When it was below its 200-period average")}</div>
        <p class="muted" style="margin:6px 0 14px">${setupVerdict(sh)} Based on ${sh.up.n + sh.down.n} past ${UNIT[gran()][1]}.</p>`;
    }

    const sim = Indicators.findSimilar(h);
    if (sim) {
      const [h1, h2] = sim.horizons, s1 = sim.summary[h1], s2 = sim.summary[h2];
      const line = (hh, s) => `<div><span class="muted">${units(hh)} later</span><b class="${s.median >= 0 ? "up" : "down"}">${p0(s.median)}</b><span class="muted">typical · up in ${s.up} of ${s.total} · from ${p0(s.worst)} to ${p0(s.best)}</span></div>`;
      html += `<h3 class="subh">Similar moments in the past</h3>
        <p style="margin-bottom:8px">The last ${units(sim.window)} of ${esc(name)}'s chart look most like these ${sim.matches.length} earlier moments. Here is what happened next each time:</p>
        <div class="stats setup">${line(h1, s1)}${line(h2, s2)}</div>
        <div class="sims">${sim.matches.map((m) => `<div class="sim" title="${Math.round(m.similarity * 100)}% similar shape">
          ${spark(m.path, sim.window)}
          <div><b>${new Date(m.time * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</b> <span class="muted">${Math.round(m.similarity * 100)}% alike</span></div>
          <div class="${m.after[h2] >= 0 ? "up" : "down"}">then ${p0(m.after[h2])} in ${units(h2)}</div></div>`).join("")}</div>
        <p class="muted" style="margin-top:8px">Grey is the matching pattern, the coloured part is what followed. <b>How much to trust this: not much.</b> We tested this method on about 3,200 past cases across 10 coins,
        and the matches got the direction right about half the time, the same as a coin flip. It shows the range of things that have happened, not what will happen.</p>`;
    } else if (!stillLoading) {
      html += `<p class="muted">Not enough price history to look for similar patterns yet.</p>`;
    }
    return html;
  }

  function coinNewsHtml(sym) {
    const d = research[sym]?.data;
    if (!d) return "";
    const items = d.news?.coin || [];
    return `<h2 id="d-news">Latest news <span class="muted">headlines that mention ${esc(coinName(sym) || sym)}</span></h2>` +
      (items.length ? newsList(items) : `<p class="muted">No recent headlines mention it. ${d.news?.error ? "(News is unavailable right now.)" : "See the Buzz tab for the top crypto stories."}</p>`);
  }

  function renderResearch(sym) {
    const el = document.getElementById("dr-pattern");
    if (!el || !sym || !results[sym] || results[sym].error) return;
    // Beginners get the simpler view: reasons for/against and news, without the pattern history.
    const beginner = window.userLevel?.() === "beginner";
    const mv = document.getElementById("detailMove");
    if (mv) mv.innerHTML = moveHtml(sym);
    const put = (id, html) => { const x = document.getElementById(id); if (x) x.innerHTML = html; };
    put("dr-pattern", patternHtml(sym)); put("dr-reasons", reasonsHtml(sym));
    put("dr-history", beginner ? "" : historyHtml(sym)); put("dr-news", coinNewsHtml(sym));
    loadResearch(sym); loadDeep(sym);
    window.syncJump?.();
  }

  // Compact research data for the AI. Headlines are untrusted text; the server prompt says so.
  window.researchSnapshot = () => {
    const m = research[""]?.data, sym = selected, out = { fearGreed: m?.fearGreed || null, market: m?.global || null, topHeadlines: (m?.news?.top || []).slice(0, 5).map((n) => n.title) };
    if (sym && results[sym] && !results[sym].error) {
      const h = history(sym), sim = h && Indicators.findSimilar(h), sh = h && Indicators.setupHistory(h, 30);
      out.selectedCoin = {
        coin: sym,
        otherReasons: reasons(sym).map((x) => `${x.side}: ${x.title}. ${x.text.replace(/<[^>]+>/g, "")}`),
        aboveVsBelow200avg: sh && { now: sh.now, above: { medianNext30Pct: Math.round(sh.up.median * 100), upPct: Math.round(sh.up.pctUp * 100) }, below: { medianNext30Pct: Math.round(sh.down.median * 100), upPct: Math.round(sh.down.pctUp * 100) } },
        similarPastPatterns: sim && { note: "Tested: these matches predict direction no better than a coin flip. History, not a forecast.", after: Object.fromEntries(sim.horizons.map((hh) => [hh + " candles", { up: sim.summary[hh].up, of: sim.summary[hh].total, medianPct: Math.round(sim.summary[hh].median * 100) }])) },
        headlines: (research[sym]?.data?.news?.coin || []).map((n) => n.title),
        whyItsMoving: (() => { const i = moveInfo(sym); return i && { verdict: i.verdict, change24hPct: i.d1 != null ? +(i.d1 * 100).toFixed(1) : null, change7dPct: +(i.w * 100).toFixed(1), change30dPct: i.m != null ? +(i.m * 100).toFixed(1) : null, mainCause: i.cause, drivers: i.drivers.map((d) => `${d.dir}: ${d.title}. ${d.text.replace(/<[^>]+>/g, "")}`) }; })(),
        chartPattern: (() => { const i = patternInfo(sym); return i && { pattern: i.pat.name, textbookBias: i.pat.bias, studyLean: i.lean, studyCases: i.p?.n || 0, studyPctHigher30d: i.p ? Math.round(i.p.up * 100) : null, ordinaryDayPctHigher30d: i.study ? Math.round(i.study.baseline.up * 100) : null, ownHistoryCases: i.own.n, ownPctHigher: i.own.n ? Math.round(i.own.up * 100) : null, note: "Measured over 10 coins, 2022-2026, daily charts. A lean only counts if it held in both halves of the period. Not a forecast." }; })(),
      };
    }
    return out;
  };
  window.renderResearch = renderResearch;

  document.addEventListener("prices-updated", () => { loadResearch(""); renderMarket(); });
  document.addEventListener("currency-changed", () => { renderMarket(); if (selected) renderResearch(selected); });
  renderMarket();
})();
