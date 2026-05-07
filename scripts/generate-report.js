#!/usr/bin/env node
/**
 * HTMLレポート生成スクリプト
 *
 * /tmp/workload.json を読み込み、未来キャパ予報のHTMLを生成する
 *
 * Usage:
 *   node scripts/generate-report.js
 *   node scripts/generate-report.js --input /tmp/workload.json --output /tmp/capacity-report.html
 */

const fs   = require('fs');
const path = require('path');

// ============================================================
// 引数パース
// ============================================================
const args        = process.argv.slice(2);
const inputIndex  = args.indexOf('--input');
const outputIndex = args.indexOf('--output');
const inputPath   = inputIndex  !== -1 ? args[inputIndex  + 1] : '/tmp/workload.json';
const outputPath  = outputIndex !== -1 ? args[outputIndex + 1] : 'capacity-report.html';

// ============================================================
// HTML生成
// ============================================================
function generateHTML(data) {
  const { currentWeek, weeks, topDangerWeeks, summary, alerts, recommendation, config } = data;
  const hangoverAlerts  = alerts?.hangover?.items          || [];
  const selfInvestSummary = alerts?.selfInvestment         || {};
  const maxHours        = config.maxLoadHoursForBar;

  function getBannerStyle(level) {
    const styles = {
      1: { bg: '#ecfdf5', border: '#6ee7b7', text: '#065f46', label_bg: '#d1fae5' },
      2: { bg: '#f0fdf4', border: '#10b981', text: '#064e3b', label_bg: '#dcfce7' },
      3: { bg: '#fffbeb', border: '#fbbf24', text: '#92400e', label_bg: '#fef3c7' },
      4: { bg: '#fff7ed', border: '#fed7aa', text: '#7c2d12', label_bg: '#ffedd5' },
      5: { bg: '#fef2f2', border: '#fca5a5', text: '#7f1d1d', label_bg: '#fee2e2' },
    };
    return styles[level] || styles[2];
  }

  function barWidth(loadHours) {
    return Math.min((loadHours / maxHours) * 100, 100).toFixed(1);
  }

  // ── バー表示の基準定義 ────────────────────────────────────────
  function hPct(h) {
    return Math.min((h / maxHours) * 100, 100).toFixed(1);
  }

  // 基準位置（%）
  const pct20 = hPct(20);
  const pct35 = hPct(35);
  const pct40 = hPct(40);
  const pct50 = hPct(50);

  /**
   * 棒グラフ（案B：3色）
   *   0〜35h  : 緑
   *   35〜40h : 黄
   *   40h〜   : 赤
   */
  const BAR_SEGS = [
    { from: 0,  to: 35,       color: '#10b981' },
    { from: 35, to: 40,       color: '#eab308' },
    { from: 40, to: Infinity, color: '#ef4444' },
  ];

  function barSegHtml(totalH) {
    const segs = [];
    for (let i = 0; i < BAR_SEGS.length; i++) {
      const s = BAR_SEGS[i];
      if (totalH <= s.from) break;
      const segEnd  = Math.min(totalH, s.to === Infinity ? totalH : s.to);
      const leftPct = hPct(s.from);
      const wPct    = ((segEnd - s.from) / maxHours * 100).toFixed(1);
      const isFirst = i === 0;
      const isLast  = segEnd >= totalH;
      const br = isFirst && isLast ? '4px'
               : isFirst           ? '4px 0 0 4px'
               : isLast            ? '0 4px 4px 0'
               : '0';
      segs.push(`<div style="position:absolute; left:${leftPct}%; top:0; height:100%; width:${wPct}%; background:${s.color}; border-radius:${br}; z-index:2;"></div>`);
    }
    return segs.join('');
  }

  // ── 週バーの行 HTML ──────────────────────────────────────────
  function weekBarRow(week) {
    const isAlert = week.level >= 3;
    const rowBg   = week.isCurrentWeek
      ? 'background:#fffbeb; border:1px solid #fde68a; border-radius:6px;'
      : '';

    // 40h 超過量表示
    const overH    = week.totalLoadHours > 40
      ? Math.round((week.totalLoadHours - 40) * 10) / 10 : null;
    const overSpan = overH
      ? `<span style="font-size:9px; color:#ef4444; margin-left:2px; font-weight:600;">+${overH}h</span>`
      : '';

    const hasMultiplier = Math.abs(week.totalHours - week.totalLoadHours) >= 0.5;
    const hoursDisplay  = hasMultiplier && !overH
      ? `<span style="font-size:11px; font-weight:600; color:${week.levelTextColor};">${week.totalLoadHours}h</span><span style="font-size:10px; color:#94a3b8; margin-left:2px;">(拘束${week.totalHours}h)</span>`
      : `<span style="font-size:11px; font-weight:600; color:${week.levelTextColor};">${week.totalLoadHours}h</span>${overSpan}`;

    // バッジ
    const hasDrinking = (week.hanoverAlerts || []).length > 0;
    const hasInvDef   = week.selfInvestment?.isDeficient;
    const badges = [
      week.hasRecovery ? `<span title="回復予定あり">🛁</span>`      : '',
      hasDrinking      ? `<span title="二日酔いロスリスク">🍺</span>` : '',
      hasInvDef        ? `<span title="自己投資不足">📚</span>`       : '',
      isAlert          ? `<span style="color:${week.levelTextColor}; font-weight:700;">!</span>` : '',
    ].filter(Boolean).join('');

    return `
      <div style="display:flex; align-items:center; gap:6px; padding:4px 6px; margin-bottom:3px; ${rowBg}">
        <span style="width:10px; font-size:10px; color:#f59e0b; flex-shrink:0;">${week.isCurrentWeek ? '▶' : ''}</span>
        <span style="width:72px; font-size:11px; color:#475569; flex-shrink:0; white-space:nowrap;">${week.label}</span>
        <div style="flex:1; position:relative; height:18px; border-radius:4px; overflow:visible;">
          <!-- 背景：40h左は薄グレー、右は薄オレンジの2ゾーン -->
          <div style="position:absolute; left:0; top:0; width:${pct40}%; height:100%;
                      background:rgba(226,232,240,0.5); border-radius:4px 0 0 4px; z-index:0;"></div>
          <div style="position:absolute; left:${pct40}%; top:0; right:0; height:100%;
                      background:rgba(251,146,60,0.12); border-radius:0 4px 4px 0; z-index:0;"></div>
          <!-- 35h 補助線（ラベルなし・細い黄色点線） -->
          <div style="position:absolute; left:calc(${pct35}% - 0.5px); top:0; bottom:0; width:1px;
                      background:repeating-linear-gradient(to bottom,#eab308 0,#eab308 2px,transparent 2px,transparent 5px);
                      opacity:0.45; z-index:1;"></div>
          <!-- 50h 補助線（ラベルなし・細い赤点線、maxHours>50 のみ） -->
          ${maxHours > 50 ? `<div style="position:absolute; left:calc(${pct50}% - 0.5px); top:0; bottom:0; width:1px;
                      background:repeating-linear-gradient(to bottom,#ef4444 0,#ef4444 2px,transparent 2px,transparent 5px);
                      opacity:0.4; z-index:1;"></div>` : ''}
          <!-- 20h 補助線（ラベルあり・細い緑破線） -->
          <div style="position:absolute; left:calc(${pct20}% - 0.5px); top:-3px; bottom:-3px; width:1px;
                      background:repeating-linear-gradient(to bottom,#10b981 0,#10b981 3px,transparent 3px,transparent 6px);
                      opacity:0.6; z-index:2;"></div>
          <!-- 40h 基準線（ラベルあり・太いオレンジ破線・最も目立つ） -->
          <div style="position:absolute; left:calc(${pct40}% - 1px); top:-5px; bottom:-5px; width:2px;
                      background:repeating-linear-gradient(to bottom,#f97316 0,#f97316 4px,transparent 4px,transparent 8px);
                      opacity:0.9; z-index:3;"></div>
          ${barSegHtml(week.totalLoadHours)}
        </div>
        <div style="width:100px; text-align:right; flex-shrink:0;">${hoursDisplay}</div>
        <div style="width:48px; display:flex; gap:1px; justify-content:flex-end; flex-shrink:0; font-size:11px;">${badges}</div>
      </div>`;
  }

  // ── 危険週 TOP3 カード ───────────────────────────────────────
  function dangerWeekCard(week, rank) {
    const hasMultiplier = Math.abs(week.totalHours - week.totalLoadHours) >= 0.5;
    const hasDrinking   = (week.hanoverAlerts || []).length > 0;
    const hasInvDef     = week.selfInvestment?.isDeficient;
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:${week.levelBgColor}; border:1px solid ${week.levelColor}; border-radius:8px;">
        <span style="width:22px; height:22px; background:${week.levelColor}; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0;">${rank}</span>
        <div style="flex:1;">
          <div style="font-size:12px; font-weight:600; color:${week.levelTextColor};">${week.label}</div>
          <div style="font-size:11px; color:#64748b; margin-top:1px;">
            ${week.levelEmoji} ${week.levelName}${week.hasRecovery ? ' 🛁' : ''}${hasDrinking ? ' 🍺' : ''}${hasInvDef ? ' 📚' : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:18px; font-weight:700; color:${week.levelTextColor};">${week.totalLoadHours}h</div>
          <div style="font-size:10px; color:#94a3b8;">${hasMultiplier ? `拘束${week.totalHours}h` : '/ 週'}</div>
        </div>
      </div>`;
  }

  // ── 自己投資アラートカード ────────────────────────────────────
  function selfInvestCard() {
    const deficientWeeks = weeks.filter(w => w.selfInvestment?.isDeficient);
    const criticalWeeks  = weeks.filter(w => w.selfInvestment?.isCritical);
    const okWeeks        = weeks.filter(w => !w.selfInvestment?.isDeficient);

    const avgHours = selfInvestSummary.weeklyAvgHours || 0;
    const totalH   = selfInvestSummary.totalHours || 0;

    const riskBadge = selfInvestSummary.futureIncomeRisk
      ? `<span style="padding:2px 8px; background:#fef2f2; color:#b91c1c; border:1px solid #fca5a5; border-radius:12px; font-size:10px; font-weight:700;">⚠️ 未来収入リスク</span>`
      : '';

    // 週別インジケーター（簡易ドット表示）
    const weekDots = weeks.map(w => {
      const si = w.selfInvestment;
      if (!si || si.level === 'ok') return `<span title="${w.label} ${si?.totalHours || 0}h" style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#10b981; margin:1px;"></span>`;
      if (si.level === 'low')      return `<span title="${w.label} ${si.totalHours}h" style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#fbbf24; margin:1px;"></span>`;
      return `<span title="${w.label} ${si.totalHours}h" style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#ef4444; margin:1px;"></span>`;
    }).join('');

    let alertMsg = '';
    if (criticalWeeks.length > 0 && !criticalWeeks[0].selfInvestment?.softMode) {
      alertMsg = `📚 深刻な不足が${criticalWeeks.length}週あります。AI学習・制作・練習をカレンダーに先入れしてください。`;
    } else if (deficientWeeks.length > 4) {
      alertMsg = `📚 多くの週で自己投資が少なめです。1日15分のSNS制作やAI学習から始めてみましょう。`;
    } else if (deficientWeeks.length > 0) {
      alertMsg = `📚 一部の週で自己投資時間が${5}h未満です。隙間時間に読書や個人制作を入れてみてください。`;
    }

    return `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div class="section-title" style="margin-bottom:0;">🧠 未来投資時間</div>
        ${riskBadge}
      </div>
      <div style="display:flex; gap:16px; margin-bottom:10px;">
        <div style="text-align:center;">
          <div style="font-size:22px; font-weight:800; color:#6366f1;">${totalH}h</div>
          <div style="font-size:10px; color:#94a3b8;">13週合計</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px; font-weight:800; color:#6366f1;">${avgHours}h</div>
          <div style="font-size:10px; color:#94a3b8;">週平均</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px; font-weight:800; color:${criticalWeeks.length > 0 ? '#ef4444' : deficientWeeks.length > 0 ? '#f59e0b' : '#10b981'};">${deficientWeeks.length}</div>
          <div style="font-size:10px; color:#94a3b8;">不足週</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px; font-weight:800; color:#10b981;">${okWeeks.length}</div>
          <div style="font-size:10px; color:#94a3b8;">OK週</div>
        </div>
      </div>
      <div style="margin-bottom:8px; line-height:1; display:flex; flex-wrap:wrap; gap:0;">
        ${weekDots}
      </div>
      <div style="display:flex; gap:8px; font-size:10px; color:#94a3b8; margin-bottom:${alertMsg ? 8 : 0}px;">
        <span>🟢 5h以上</span><span>🟡 3〜5h</span><span>🔴 3h未満</span>
      </div>
      ${alertMsg ? `<div style="font-size:12px; color:#334155; line-height:1.6; padding:8px 10px; background:#f8fafc; border-radius:6px;">${alertMsg}</div>` : ''}
    </div>`;
  }

  // ── 二日酔いロスカード ───────────────────────────────────────
  function hangoverCard() {
    if (hangoverAlerts.length === 0) return '';

    const conflictAlerts = hangoverAlerts.filter(a => a.riskType === 'self_invest_conflict');
    const morningAlerts  = hangoverAlerts.filter(a => a.riskType === 'morning_busy');

    const headerColor = conflictAlerts.length > 0 ? '#b45309' : '#92400e';

    const alertItems = hangoverAlerts.map(a => {
      const dotColor = a.riskType === 'self_invest_conflict' ? '#ef4444'
                     : a.riskType === 'morning_busy'         ? '#f97316'
                     : '#94a3b8';
      return `
        <div style="display:flex; gap:8px; padding:8px 10px; background:#fffbeb; border-radius:6px; margin-bottom:6px;">
          <span style="width:6px; height:6px; border-radius:50%; background:${dotColor}; margin-top:5px; flex-shrink:0;"></span>
          <span style="font-size:11px; color:#78350f; line-height:1.6;">${a.message.replace('🍺 ', '')}</span>
        </div>`;
    }).join('');

    return `
    <div class="card" style="border-color:#fde68a;">
      <div class="section-title" style="color:${headerColor};">🍺 二日酔いロス注意</div>
      ${alertItems}
      <div style="margin-top:6px; font-size:10px; color:#94a3b8;">翌日の回復ロスは約5hで計算しています。飲む日の翌朝はタスクを軽めに設計してください。</div>
    </div>`;
  }

  // ── バナー・その他 ───────────────────────────────────────────
  const bannerStyle   = getBannerStyle(currentWeek.level);
  const dangerCardsHTML = topDangerWeeks.length > 0
    ? topDangerWeeks.map((w, i) => dangerWeekCard(w, i + 1)).join('')
    : `<div style="padding:12px; text-align:center; color:#10b981; font-size:13px;">🎉 アラート週はありません</div>`;

  const generatedDate = new Date(data.generatedAt).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  // 今週バナーの追加バッジ
  const currentHasDrinking = (currentWeek.hanoverAlerts || []).length > 0;
  const currentHasInvDef   = currentWeek.selfInvestment?.isDeficient;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>未来キャパ予報</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', 'Segoe UI', sans-serif;
      background: #f8fafc;
      padding: 24px;
      min-height: 100vh;
    }
    .card {
      background: white;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.07);
      padding: 16px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div style="width:420px; margin:0 auto;">

    <!-- ヘッダー -->
    <div class="card" style="padding:14px 16px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px; height:36px; background:linear-gradient(135deg,#6366f1,#8b5cf6); border-radius:9px; display:flex; align-items:center; justify-content:center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div>
            <div style="font-size:15px; font-weight:700; color:#0f172a;">未来キャパ予報</div>
            <div style="font-size:11px; color:#94a3b8;">がんばりすぎアラート付き週間稼働レポート</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px; color:#64748b;">${generatedDate}</div>
          <div style="font-size:10px; color:#94a3b8;">13週間</div>
        </div>
      </div>
    </div>

    <!-- 今週ステータスバナー -->
    <div class="card" style="background:${bannerStyle.bg}; border-color:${bannerStyle.border}; padding:14px 16px;">
      <div class="section-title" style="color:${bannerStyle.text}; opacity:0.7;">今週のステータス</div>
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <div style="font-size:13px; color:${bannerStyle.text}; margin-bottom:4px;">${currentWeek.label}</div>
          <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; background:${bannerStyle.label_bg}; border-radius:20px;">
            <span style="font-size:13px;">${currentWeek.levelEmoji}</span>
            <span style="font-size:13px; font-weight:700; color:${currentWeek.levelTextColor};">${currentWeek.levelName}</span>
            ${currentWeek.hasRecovery  ? '<span style="font-size:13px;">🛁</span>' : ''}
            ${currentHasDrinking       ? '<span style="font-size:13px;">🍺</span>' : ''}
            ${currentHasInvDef         ? '<span style="font-size:13px;">📚</span>' : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:32px; font-weight:800; color:${currentWeek.levelTextColor}; line-height:1;">${currentWeek.totalLoadHours}</div>
          <div style="font-size:11px; color:${bannerStyle.text}; opacity:0.7;">h稼働${currentWeek.totalHours !== currentWeek.totalLoadHours ? ` / 拘束${currentWeek.totalHours}h` : ''}</div>
        </div>
      </div>
    </div>

    <!-- 13週間の週別負荷一覧 -->
    <div class="card">
      <div class="section-title">13週間の稼働予測</div>

      <!-- 基準ラベル行（20h・40h のみ表示） -->
      <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px; padding:0 6px;">
        <span style="width:10px; flex-shrink:0;"></span>
        <span style="width:72px; flex-shrink:0;"></span>
        <div style="flex:1; position:relative; height:14px;">
          <!-- 20h ラベル（補助・緑系） -->
          <span style="position:absolute; left:calc(${pct20}% - 7px); bottom:0;
                       font-size:8px; font-weight:500; color:#6ee7b7; white-space:nowrap;">20h</span>
          <!-- 40h ラベル（主役・オレンジ・太字） -->
          <span style="position:absolute; left:calc(${pct40}% - 14px); bottom:0;
                       font-size:9px; font-weight:700; color:#f97316; white-space:nowrap;">40h基準</span>
        </div>
        <div style="width:100px; flex-shrink:0;"></div>
        <div style="width:48px; flex-shrink:0;"></div>
      </div>

      ${weeks.map(week => weekBarRow(week)).join('')}

      <!-- バッジ凡例（バーの下・小さめ） -->
      <div style="margin-top:8px; padding-top:8px; border-top:1px solid #f1f5f9;
                  display:flex; gap:10px; font-size:9px; color:#cbd5e1; flex-wrap:wrap;">
        <span>🟢 〜35h</span><span>🟡 35〜40h</span><span>🔴 40h超</span>
        <span style="margin-left:auto;">🛁 回復</span><span>🍺 飲酒</span><span>📚 自己投資不足</span>
      </div>
    </div>

    <!-- 危険週 TOP3 -->
    <div class="card">
      <div class="section-title">
        ${topDangerWeeks.length > 0 ? `⚠️ 要注意週 TOP${topDangerWeeks.length}` : '要注意週'}
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${dangerCardsHTML}
      </div>
    </div>

    <!-- 🧠 未来投資時間 -->
    ${selfInvestCard()}

    <!-- 🍺 二日酔いロス注意（アラートがある場合のみ） -->
    ${hangoverCard()}

    <!-- 一言アドバイス -->
    <div class="card" style="background:#f8fafc;">
      <div class="section-title">📋 一言アドバイス</div>
      <p style="font-size:13px; color:#334155; line-height:1.6;">${recommendation}</p>
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid #e2e8f0; display:flex; gap:12px; flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:20px; font-weight:700; color:#6366f1;">${summary.totalAlertWeeks}</div>
          <div style="font-size:10px; color:#94a3b8;">アラート週</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:20px; font-weight:700; color:#6366f1;">${summary.maxLevelName}</div>
          <div style="font-size:10px; color:#94a3b8;">最高リスク</div>
        </div>
        ${hangoverAlerts.length > 0 ? `
        <div style="text-align:center;">
          <div style="font-size:20px; font-weight:700; color:#f59e0b;">${hangoverAlerts.length}</div>
          <div style="font-size:10px; color:#94a3b8;">🍺 飲酒ロス</div>
        </div>` : ''}
        ${selfInvestSummary.weeksDeficient > 0 ? `
        <div style="text-align:center;">
          <div style="font-size:20px; font-weight:700; color:${selfInvestSummary.weeksCritical > 0 ? '#ef4444' : '#f59e0b'};">${selfInvestSummary.weeksDeficient}</div>
          <div style="font-size:10px; color:#94a3b8;">📚 投資不足週</div>
        </div>` : ''}
      </div>
    </div>

    <!-- 色の凡例 -->
    <div class="card" style="padding:12px 16px;">
      <div class="section-title">色の凡例</div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${[
          { color: '#6ee7b7', name: '余力あり',         range: '〜20h / 週' },
          { color: '#10b981', name: '通常運転',         range: '21〜35h / 週' },
          { color: '#fbbf24', name: '入れすぎ注意',     range: '36〜44h / 週' },
          { color: '#f97316', name: '追加予定NG',       range: '45〜49h / 週' },
          { color: '#ef4444', name: '回復日を強制確保', range: '50h以上 / 週' },
        ].map(item => `
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:14px; height:14px; background:${item.color}; border-radius:3px; flex-shrink:0;"></div>
            <span style="font-size:12px; font-weight:600; color:#374151; width:120px;">${item.name}</span>
            <span style="font-size:11px; color:#94a3b8;">${item.range}</span>
          </div>`).join('')}
      </div>

      <!-- 用語の定義 -->
      <div style="margin-top:12px; padding-top:10px; border-top:1px solid #f1f5f9;">
        <div style="font-size:10px; font-weight:600; color:#94a3b8; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">用語の定義</div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <div style="display:flex; gap:6px; align-items:baseline;">
            <span style="font-size:11px; font-weight:600; color:#475569; white-space:nowrap; width:80px;">稼働負荷</span>
            <span style="font-size:11px; color:#64748b; line-height:1.5;">予定内容ごとの倍率をかけた体感的な負荷。判定・バーグラフに使用。</span>
          </div>
          <div style="display:flex; gap:6px; align-items:baseline;">
            <span style="font-size:11px; font-weight:600; color:#475569; white-space:nowrap; width:80px;">拘束時間</span>
            <span style="font-size:11px; color:#64748b; line-height:1.5;">カレンダーに入っている予定の合計時間（倍率なし）。</span>
          </div>
          <div style="display:flex; gap:6px; align-items:baseline;">
            <span style="font-size:13px; white-space:nowrap; width:80px;">🛁</span>
            <span style="font-size:11px; color:#64748b; line-height:1.5;">温泉・サウナ・美容・休みなど、回復予定を含む週。</span>
          </div>
          <div style="display:flex; gap:6px; align-items:baseline;">
            <span style="font-size:13px; white-space:nowrap; width:80px;">🍺</span>
            <span style="font-size:11px; color:#64748b; line-height:1.5;">飲酒予定あり。翌日5hのロスを見込んで予定を設計してください。</span>
          </div>
          <div style="display:flex; gap:6px; align-items:baseline;">
            <span style="font-size:13px; white-space:nowrap; width:80px;">📚</span>
            <span style="font-size:11px; color:#64748b; line-height:1.5;">自己投資（AI学習・制作・練習など）が週5h未満の週。</span>
          </div>
        </div>
      </div>

      <div style="margin-top:10px; font-size:10px; color:#cbd5e1; text-align:right;">Generated by 未来キャパ予報</div>
    </div>

  </div>
</body>
</html>`;
}

// ============================================================
// メイン処理
// ============================================================
function main() {
  console.log('=== generate-report.js 開始 ===');
  console.log(`入力: ${inputPath}`);
  console.log(`出力: ${outputPath}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 入力ファイルが見つかりません: ${inputPath}`);
    console.error('先に calc-workload.js を実行してください。');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const html = generateHTML(data);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`✅ HTMLを生成しました: ${outputPath}`);
  console.log('');
  console.log('ブラウザで開くには:');
  console.log(`  open ${outputPath}`);
}

main();
