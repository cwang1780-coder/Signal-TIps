// "Learn to trade": short lessons for people new to trading. Shown in beginner mode.
// Each lesson ends with one quick question; answering it right marks the lesson done (saved in this browser).
(function () {
  const LESSONS = [
    {
      id: "basics", icon: "coin", title: "What trading crypto really means", time: "2 min",
      body: `<p>Trading means buying a coin and later selling it, hoping the price went up in between. Crypto prices move 24 hours a day, 7 days a week, and they move a lot.</p>
        <ul><li><b>You can lose money.</b> Bitcoin has fallen more than 50% several times. Smaller coins have fallen 90% or disappeared.</li>
        <li><b>Nobody can predict prices,</b> not this app, not influencers, not the AI. Anyone who promises profits is guessing or lying.</li>
        <li><b>Start small.</b> Only use money you could lose without it hurting your life.</li></ul>`,
      tryIt: { label: "See today's signals", go: "signals" },
      q: "You buy $100 of a coin and the price falls 50%. What is it worth now?",
      options: ["$50", "$100, because you haven't sold", "$150"], answer: 0,
      explain: "It's worth $50. Not selling doesn't protect you: the value really is lower until the price recovers, if it ever does.",
    },
    {
      id: "exchange", icon: "bank", title: "How buying and selling works", time: "3 min",
      body: `<p>You trade on an <b>exchange</b> such as Coinbase. You add money, then place an <b>order</b>.</p>
        <ul><li><b>Market order:</b> buys or sells right now at the current price. Simple, but the price can slip a little.</li>
        <li><b>Limit order:</b> only buys or sells at the price you choose or better. It may never fill if the price doesn't get there.</li>
        <li><b>Fees and spread:</b> every buy and sell costs a little. Lots of small trades add up to lots of fees.</li>
        <li><b>Where your coins live:</b> on the exchange, or in your own wallet such as Exodus. A wallet gives you a <b>recovery phrase</b>. Never share it with anyone, ever. Real support staff never ask for it.</li></ul>`,
      tryIt: { label: "Open a coin and its trade links", go: "signals" },
      q: "What does a limit order do?",
      options: ["Buys immediately at whatever the price is", "Only buys or sells at your chosen price or better", "Limits how much the coin can fall"], answer: 1,
      explain: "A limit order waits for your price. A market order is the one that fills immediately.",
    },
    {
      id: "chart", icon: "chart", title: "Reading a price chart", time: "3 min",
      body: `<p>Open any coin to see its chart. The black line is the price over time.</p>
        <ul><li><b>Trend:</b> higher highs and higher lows means an uptrend. Lower highs and lower lows means a downtrend.</li>
        <li><b>The orange line</b> is the 200-period average: roughly the coin's long-term "normal" price. Price above it usually means a long-term uptrend; below it, a downtrend.</li>
        <li><b>The blue line</b> is the 50-period average, a shorter-term version of the same idea.</li>
        <li><b>▲ and ▼ marks</b> show where this app's signals said buy and sell in the past.</li></ul>`,
      tryIt: { label: "Open Bitcoin's chart", coin: "BTC" },
      q: "The price is above its 200-period average (the orange line). That usually means…",
      options: ["A long-term uptrend", "A long-term downtrend", "The coin is about to crash"], answer: 0,
      explain: "Above the long-term average usually means an uptrend. It's a description of the trend, not a promise about tomorrow.",
    },
    {
      id: "signals", icon: "gauge", title: "Using this app's signals", time: "2 min",
      body: `<p>Each coin gets <b>BUY</b>, <b>HOLD</b> or <b>SELL</b> from its trend and momentum.</p>
        <ul><li><b>BUY:</b> uptrend, conditions look good. <b>HOLD:</b> mixed. <b>SELL:</b> downtrend.</li>
        <li><b>SELL doesn't mean you must do anything.</b> If you don't own the coin, it just means "stay out for now".</li>
        <li>Each coin shows a <b>track record</b>: how the signals did in the past. In our tests they mostly helped by avoiding long slides, and they were often wrong.</li>
        <li>Use the signal as <b>one input</b>, together with your own plan and the Buzz and news.</li></ul>`,
      tryIt: { label: "Read what the signals mean", help: true },
      q: "A coin says SELL and you don't own it. What does that mean for you?",
      options: ["Stay out of it for now", "You have to sell something", "Buy it, because it's cheap"], answer: 0,
      explain: "SELL just means the trend is down. If you don't own it, you simply don't buy yet.",
    },
    {
      id: "risk", icon: "shield", title: "Managing risk", time: "3 min",
      body: `<p>Good traders focus on how much they could lose, not how much they could win.</p>
        <ul><li><b>Position size:</b> don't put too much into one coin. Many people cap each coin at a small slice (for example 5%) of what they invest.</li>
        <li><b>Have an exit plan before you buy:</b> a price where you'll take profit and a <b>stop-loss</b> price where you'll sell to limit a loss.</li>
        <li><b>Dollar-cost averaging:</b> buying a fixed amount on a schedule instead of all at once smooths out bad timing.</li>
        <li><b>Don't chase losses</b> by buying more just to "win it back".</li></ul>`,
      tryIt: { label: "Set an alert at your stop-loss price", go: "alerts" },
      q: "What is a stop-loss?",
      options: ["A price where you plan to sell to limit a loss", "A rule that stops the price from falling", "A fee the exchange charges"], answer: 0,
      explain: "It's your own exit price for when a trade goes wrong. An alert here can remind you when the price gets there.",
    },
    {
      id: "scams", icon: "alert", title: "Hype, scams and emotions", time: "3 min",
      body: `<p>Crypto attracts scammers, and hype makes people act fast without thinking.</p>
        <ul><li><b>FOMO</b> (fear of missing out) makes people buy at the top. If everyone is excited, be extra careful.</li>
        <li><b>Pump and dump:</b> groups hype a small coin, sell to the people who rush in, and the price collapses.</li>
        <li><b>Always scams:</b> "guaranteed returns", "send me crypto and I'll double it", anyone asking for your recovery phrase, and "support" that messages you first.</li>
        <li>Check the <b>Buzz</b> page: very high hype with almost everyone bullish is a warning sign, not a reason to buy.</li></ul>`,
      tryIt: { label: "Check today's hype", go: "buzz" },
      q: "Someone in a chat offers to double your crypto if you send it to them first. This is…",
      options: ["A scam", "A good deal if they seem friendly", "Safe if it's a small amount"], answer: 0,
      explain: "Always a scam. Nobody can double your money, and crypto you send can't be taken back.",
    },
    {
      id: "plan", icon: "note", title: "Your first practice trade", time: "4 min",
      body: `<p>Practise before using real money. This is called <b>paper trading</b>.</p>
        <ol><li>Pick one coin and read its signal, reasons and track record.</li>
        <li>Write your plan: why you'd buy, your profit price and your stop-loss price.</li>
        <li>Add a pretend holding in <b>My coins</b> with the price you would have paid.</li>
        <li>Set alerts at your profit and stop-loss prices.</li>
        <li>Check back in a week or two. Did your plan work? What would you change?</li></ol>
        <p>When you do trade for real, keep records of every buy and sell: in many countries crypto profits are taxed.</p>`,
      tryIt: { label: "Add a practice holding", go: "coins" },
      q: "Before buying, what should you decide?",
      options: ["When you'll sell, both for profit and for a loss", "Nothing, you can decide later", "Only how much profit you want"], answer: 0,
      explain: "Deciding both exits in advance keeps emotions out of it when the price moves.",
    },
  ];

  const store = window.store || { get: (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const done = () => new Set(store.get("learnDone", []));
  let openId = null;

  function progressText() {
    const d = done().size;
    return d === LESSONS.length ? "All 7 lessons done" : `${d} of ${LESSONS.length} lessons done`;
  }

  function render() {
    const d = done();
    const next = LESSONS.find((l) => !d.has(l.id));
    const pct = Math.round((d.size / LESSONS.length) * 100);
    const el = document.getElementById("learnList");
    if (!el) return;
    document.getElementById("learnProgress").innerHTML = `<div class="prog"><i style="width:${pct}%"></i></div><span>${progressText()}</span>`;
    el.innerHTML = LESSONS.map((l, i) => {
      const isOpen = openId === l.id, isDone = d.has(l.id);
      return `<article class="lesson ${isOpen ? "open" : ""} ${isDone ? "done" : ""}" id="lesson-${l.id}">
        <button class="lesson-head" data-lesson="${l.id}" aria-expanded="${isOpen}">
          <span class="lesson-ico">${icon(isDone ? "check" : l.icon)}</span>
          <span class="lesson-title"><span class="muted">Lesson ${i + 1} · ${l.time}</span><b>${l.title}</b></span>
          <span class="lesson-caret">${isOpen ? "▲" : "▼"}</span>
        </button>
        ${isOpen ? `<div class="lesson-body">${l.body}
          <div class="lesson-try"><button class="pill dark" data-try="${l.id}">Try it: ${l.tryIt.label} →</button></div>
          <div class="quiz" data-quiz="${l.id}"><p><b>Quick check:</b> ${l.q}</p>
            ${l.options.map((o, k) => `<button class="quiz-opt" data-q="${l.id}" data-k="${k}">${o}</button>`).join("")}
            <p class="quiz-out" id="quiz-out-${l.id}" ${isDone ? "" : "hidden"}>${isDone ? l.explain : ""}</p></div>
          ${isDone && LESSONS[i + 1] ? `<button class="primary" data-lesson="${LESSONS[i + 1].id}">Next lesson: ${LESSONS[i + 1].title} →</button>` : ""}
        </div>` : ""}
      </article>`;
    }).join("");
    // Home-screen "Start here" card
    const sh = document.getElementById("startHere");
    if (sh) sh.innerHTML = `<span class="sh-ico">${icon("cap")}</span><span><b>New to trading? Start here.</b><span class="muted">${progressText()}${next ? ` · Next: ${next.title}` : ""}</span></span><span class="sh-go">${next ? "Continue →" : "Review →"}</span>`;
  }

  function open(id) {
    openId = openId === id ? null : id;
    render();
    if (openId) document.getElementById("lesson-" + openId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("click", (e) => {
    const head = e.target.closest("[data-lesson]");
    if (head) { open(head.dataset.lesson); return; }
    const opt = e.target.closest(".quiz-opt");
    if (opt) {
      const l = LESSONS.find((x) => x.id === opt.dataset.q), k = +opt.dataset.k, out = document.getElementById("quiz-out-" + l.id);
      opt.parentNode.querySelectorAll(".quiz-opt").forEach((b) => b.classList.remove("right", "wrong"));
      if (k === l.answer) {
        opt.classList.add("right");
        const d = done(); d.add(l.id); store.set("learnDone", [...d]);
        out.hidden = false; out.textContent = "Correct. " + l.explain;
        setTimeout(render, 900);
      } else {
        opt.classList.add("wrong");
        out.hidden = false; out.textContent = "Not quite. Have another look at the lesson above and try again.";
      }
      return;
    }
    const t = e.target.closest("[data-try]");
    if (t) {
      const l = LESSONS.find((x) => x.id === t.dataset.try).tryIt;
      if (l.coin && window.openCoin) window.openCoin(l.coin);
      else if (l.help) document.querySelector("[data-open-help]")?.click();
      else window.showTab?.(l.go);
      return;
    }
    if (e.target.closest("#startHere")) {
      window.showTab?.("learn");
      const next = LESSONS.find((x) => !done().has(x.id));
      if (next) { openId = next.id; render(); setTimeout(() => document.getElementById("lesson-" + next.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
    }
  });

  window.learnProgress = () => ({ done: done().size, total: LESSONS.length });
  render();
})();
