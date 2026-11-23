/* Risk Radar dashboard: board, detail, live-token and model views, no network.
   Reads window.RADAR from ../data.js. Hash routes drive the views:
   #/                 board
   #/detail/<slug>   one protocol's detail
   #/filter/band:<LOW|MEDIUM|HIGH|EXTREME>   board filtered to a risk band
   #/filter/category:<name>                   board filtered to a category
   #/live            protocols whose token already trades
   #/model           how the score is built */
(function () {
  'use strict';
  var D = window.RADAR;
  var view = document.getElementById('view');
  if (!D || !view) return;

  var BANDS = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
  var state = { view: 'board', slug: null, sort: 'rank', dir: 1, q: '', cat: '', chain: '', band: '', wl: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + s + '</span>';
  }
  function age(n) { return n == null ? 'unknown' : n + 'd'; }
  function bandCls(b) { return b.toLowerCase(); }
  function riskBar(score, band) {
    return '<span class="riskbar"><i class="' + bandCls(band) + '" style="width:' + Math.min(100, score) + '%"></i></span>' +
      '<span class="risknum">' + score + '</span>';
  }
  function pill(band) { return '<span class="pill ' + bandCls(band) + '">' + band + '</span>'; }

  function bySlug(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }
  function cats() {
    var seen = {}, out = [];
    D.rows.forEach(function (r) { var c = r.category || 'Uncategorised'; if (!seen[c]) { seen[c] = 1; out.push(c); } });
    return out.sort();
  }
  function chains() {
    var seen = {}, out = [];
    D.rows.forEach(function (r) { r.chains.forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } }); });
    return out.sort();
  }

  function sortRows(rows) {
    var k = state.sort, d = state.dir;
    var val = function (r) {
      if (k === 'rank') return r.rank;
      if (k === 'implied') return r.implied_value_usd;
      if (k === 'raw') return r.raw_implied_usd;
      if (k === 'risk') return r.risk_score;
      if (k === 'tvl') return r.tvl_usd;
      if (k === 'change') return r.change_7d == null ? -9999 : r.change_7d;
      if (k === 'age') return r.age_days == null ? -1 : r.age_days;
      return r.rank;
    };
    return rows.slice().sort(function (a, b) { return (val(a) - val(b)) * d || (a.rank - b.rank); });
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.band && r.risk_band !== state.band) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.wl && D.watchlist.indexOf(r.slug) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function th(label, key) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th class="num"><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }
  function rowHtml(r) {
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + '</span></td>' +
      '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + age(r.age_days) + '</td>' +
      '<td class="nowrap">' + riskBar(r.risk_score, r.risk_band) + ' ' + pill(r.risk_band) + '</td>' +
      '<td class="num">' + money(r.implied_value_usd) + '</td>' +
      '<td class="num">' + money(r.raw_implied_usd) + '</td>' +
      '</tr>';
  }

  function boardHtml() {
    var rows = sortRows(filtered());
    var wlCount = D.rows.filter(function (r) { return D.watchlist.indexOf(r.slug) >= 0; }).length;
    var h = '<div class="stats">' +
      '<div class="stat"><b>' + D.board_size + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + D.watchlist_size + '</b><span>watchlist covered (' + wlCount + ' on this board)</span></div>' +
      '<div class="stat"><b>' + D.early_size + '</b><span>early finds below the floor</span></div>' +
      '<div class="stat"><b>' + money(D.floor_usd) + '</b><span>watchlist floor (TVL)</span></div></div>';
    h += '<div class="bands">' + D.bands.map(function (b) {
      return '<span class="bandchip"><span class="dot ' + bandCls(b.band) + '"></span>' + b.band +
        ' · ' + b.count + ' rows · risk ' + b.from + '–' + b.to + '</span>';
    }).join('') + '</div>';
    h += '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '" aria-label="Search">' +
      '<select id="cat" aria-label="Category"><option value="">All categories</option>' +
      cats().map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain" aria-label="Chain"><option value="">All chains</option>' +
      chains().map(function (c) { return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<span class="seg" role="group" aria-label="Risk band">' +
      '<button type="button" data-band="" class="' + (state.band === '' ? 'on' : '') + '">All bands</button>' +
      BANDS.map(function (b) { return '<button type="button" data-band="' + b + '" class="' + (state.band === b ? 'on' : '') + '">' + b + '</button>'; }).join('') +
      '</span>' +
      '<label class="chk"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '</div>';
    h += '<p class="countline">Showing <b>' + rows.length + '</b> of ' + D.board_size +
      ' rows · snapshot ' + esc(D.as_of) + ' · sorted by ' + esc(state.sort) + '</p>';
    if (!rows.length) { h += '<div class="empty">No protocols match these filters.</div>'; return h; }
    h += '<table><thead><tr><th class="num"><button type="button" data-sort="rank">Rank' +
      (state.sort === 'rank' ? (state.dir === 1 ? ' ▲' : ' ▼') : '') + '</button></th>' +
      '<th>Protocol</th><th>Chains</th>' + th('TVL', 'tvl') + th('7d', 'change') + th('Age', 'age') +
      th('Risk', 'risk') + th('Risk-adj. value', 'implied') + th('Raw value', 'raw') +
      '</tr></thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>';
    return h;
  }

  function detailHtml(r) {
    var onWatch = D.watchlist.indexOf(r.slug) >= 0;
    var h = '<button class="back" type="button" id="back">← Back to the board</button>';
    h += '<section class="detail"><h2>' + esc(r.name) + ' ' + pill(r.risk_band) + '</h2>' +
      '<p class="meta">Rank ' + r.rank + ' of ' + D.board_size + ' · ' + esc(r.slug) + ' · ' +
      esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      (onWatch ? ' · on the watchlist' : ' · below the watchlist floor') + '</p>';
    h += '<div class="grid2"><div class="card"><h3>Value, before and after risk</h3><div class="deriv">' +
      'TVL ' + money(r.tvl_usd) + ' <span class="dim">×</span> category multiple <b>' + r.category_multiple.toFixed(2) + '</b><br>' +
      '<span class="dim">×</span> growth ' + r.growth_multiplier.toFixed(2) + ' <span class="dim">×</span> maturity ' + r.maturity_multiplier.toFixed(2) +
      ' <span class="dim">=</span> raw <b>' + money(r.raw_implied_usd) + '</b><br>' +
      'risk ' + r.risk_score + '/100 <span class="dim">→</span> factor ' + (1 - D.model.risk_haircut * r.risk_score / 100).toFixed(2) +
      ' <span class="dim">→</span> risk-adjusted <b>' + money(r.implied_value_usd) + '</b></div></div>';
    h += '<div class="card"><h3>Risk breakdown — ' + r.risk_score + ' / 100</h3>' +
      r.risk_parts.map(function (p) {
        return '<div class="rpart"><div class="lab"><span>' + esc(p.label) + '</span><span>' + p.points + ' / ' + p.cap + '</span></div>' +
          '<div class="bar"><i style="width:' + Math.round(p.points / p.cap * 100) + '%"></i></div></div>';
      }).join('') + '</div></div>';
    h += '<div class="grid2" style="margin-top:16px"><div class="card"><h3>Farm plan — 6 steps</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
    h += '<div class="card"><h3>Facts from the snapshot</h3><dl class="kv">' +
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + (r.change_7d == null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</dd>' +
      '<dt>Listed</dt><dd>' + esc(r.listed_at || 'not reported') + ' (' + age(r.age_days) + ')</dd>' +
      '<dt>Token</dt><dd>none recorded — pre-token</dd>' +
      '<dt>Category multiple</dt><dd>' + r.category_multiple.toFixed(2) + ' (median live mcap / TVL)</dd>' +
      '</dl></div></div></section>';
    return h;
  }

  function liveHtml() {
    var h = '<p class="note"><b>Already trading — not ranked.</b> These protocols record a token, so the board ' +
      'does not rank them. They are shown because their market caps set the multiples the board prices ' +
      'pre-token protocols with.</p>';
    h += '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th>' +
      '<th class="num">Market cap</th><th class="num">mcap / TVL</th><th class="num">7d</th></tr></thead><tbody>';
    h += D.live.map(function (r) {
      return '<tr><td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.multiple == null ? '—' : r.multiple.toFixed(2)) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('') + '</tbody></table>';
    return h;
  }

  function modelHtml() {
    var h = '<h2 class="sec">How it scores</h2>' +
      '<p class="body">A protocol with no token has no price, so this radar prices it the way a buyer ' +
      'would: <b>what the market already pays for live tokens in the same category</b>, times the ' +
      'protocol\'s own TVL, adjusted for growth and for how long it has run — then cut for risk.</p>' +
      '<p class="formula">raw = TVL × median(mcap / TVL of live tokens in the category) × growth × maturity<br>' +
      'risk-adjusted = raw × (1 − 0.55 × risk / 100) &nbsp;·&nbsp; board ranks by risk-adjusted value</p>' +
      '<p class="body">The multiple is the <b>median</b> market-cap-to-TVL ratio of the category\'s live-token ' +
      'protocols, clamped to 0.05–1.50. A category with fewer than three live comparables takes the global ' +
      'median instead. Growth is the 7-day TVL change, clamped to −60%…+120% and half-weighted. Maturity ' +
      'runs 0.60 for a brand-new listing to 1.00 after three years. No name is ever special-cased.</p>' +
      '<h2 class="sec">Risk score — five parts, 0 to 100</h2>' +
      '<p class="body"><b>7-day move (25):</b> inside −10%…+30% is ordinary; a steep fall may be an exit, a ' +
      'vertical rise a spike that reverses. <b>Track record (20):</b> years of running with no token beats ' +
      'weeks. <b>Chain concentration (20):</b> one chain is one point of failure. <b>Thin TVL (15):</b> ' +
      'small TVL moves on a few withdrawals. <b>Noisy comparables (20):</b> when a category\'s live ' +
      'multiples disagree, there is no anchor to price against.</p>' +
      '<h2 class="sec">Category multiples used</h2>' +
      '<table><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Live comps</th>' +
      '<th class="num">Dispersion</th></tr></thead><tbody>' +
      D.multiples.slice(0, 16).map(function (m) {
        return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.multiple.toFixed(2) + '</td>' +
          '<td class="num">' + m.comps + '</td><td class="num">' + m.dispersion.toFixed(2) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<h2 class="sec">Risk bands on this board</h2>' +
      '<table><thead><tr><th>Band</th><th class="num">Risk range</th><th class="num">Rows</th></tr></thead><tbody>' +
      D.bands.map(function (b) {
        return '<tr><td>' + pill(b.band) + '</td><td class="num">' + b.from + '–' + b.to + '</td><td class="num">' + b.count + '</td></tr>';
      }).join('') + '</tbody></table>';
    return h;
  }

  function setTab(v) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-view') === v);
    });
  }
  function render() {
    if (state.view === 'detail') {
      var r = bySlug(state.slug);
      view.innerHTML = r ? detailHtml(r) : '<div class="empty">No protocol with that slug is on the board.</div>';
      var back = document.getElementById('back');
      if (back) back.addEventListener('click', function () { location.hash = '#/'; });
      setTab('board');
      return;
    }
    if (state.view === 'live') { view.innerHTML = liveHtml(); setTab('live'); return; }
    if (state.view === 'model') { view.innerHTML = modelHtml(); setTab('model'); return; }
    view.innerHTML = boardHtml();
    setTab('board');
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; render(); });
    view.querySelectorAll('[data-band]').forEach(function (b) {
      b.addEventListener('click', function () { state.band = b.getAttribute('data-band'); render(); });
    });
  }

  function parseHash() {
    var h = location.hash || '#/';
    var parts = h.replace(/^#\//, '').split('/');
    state.view = 'board'; state.slug = null;
    if (parts[0] === 'detail' && parts[1]) { state.view = 'detail'; state.slug = decodeURIComponent(parts[1]); }
    else if (parts[0] === 'live') state.view = 'live';
    else if (parts[0] === 'model') state.view = 'model';
    else if (parts[0] === 'filter' && parts[1]) {
      var kv = parts[1].split(':');
      if (kv[0] === 'band' && BANDS.indexOf(kv[1]) >= 0) state.band = kv[1];
      if (kv[0] === 'category') state.cat = decodeURIComponent(kv[1] || '');
    }
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var v = t.getAttribute('data-view');
      location.hash = v === 'board' ? '#/' : '#/' + v;
    });
  });
  view.addEventListener('click', function (e) {
    var s = e.target.closest('[data-sort]');
    if (s) {
      var k = s.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' ? 1 : -1; }
      render(); return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', function () { parseHash(); render(); });
  parseHash();
  render();
})();
