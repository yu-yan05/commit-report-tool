#!/usr/bin/env node
/**
 * 週ごとの稼働負荷集計・判定スクリプト
 *
 * 「拘束時間」と「稼働負荷」を分けて計算する。
 *   拘束時間: カレンダー上の実際の所要時間合計
 *   稼働負荷: タイトルキーワード別の倍率を適用した時間（判定・バー表示に使用）
 *
 * 追加判定:
 *   二日酔いロス: 飲酒予定の翌日に自己投資/朝の重要タスクがある場合に警告
 *   自己投資時間: 週ごとの自己投資合計時間を集計し、不足アラートを出す
 *
 * Usage:
 *   node scripts/calc-workload.js
 *   node scripts/calc-workload.js --input /tmp/schedule.json --output /tmp/workload.json
 */

const fs = require('fs');
const path = require('path');
const { getWeeksFromToday, getWeekMonday, getTodayJST } = require('./lib/date-utils');
const LOAD_KEYWORDS     = require('../configs/load-keywords');
const DRINKING_KEYWORDS = require('../configs/drinking-keywords');
const SELF_INVEST_KW    = require('../configs/self-investment-keywords');

// ============================================================
// 引数パース
// ============================================================
const args = process.argv.slice(2);
const inputIndex  = args.indexOf('--input');
const outputIndex = args.indexOf('--output');
const inputPath   = inputIndex  !== -1 ? args[inputIndex  + 1] : '/tmp/schedule.json';
const outputPath  = outputIndex !== -1 ? args[outputIndex + 1] : '/tmp/workload.json';

// ============================================================
// キーワード照合（稼働負荷倍率）
// ============================================================
function matchKeyword(title) {
  for (const rule of LOAD_KEYWORDS) {
    if (rule.keywords.some(kw => title.includes(kw))) {
      return rule;
    }
  }
  return { multiplier: 1.0, label: '通常', isRecovery: false };
}

function isDrinkingEvent(title) {
  return DRINKING_KEYWORDS.some(kw => title.includes(kw));
}

function isSelfInvestEvent(title) {
  return SELF_INVEST_KW.some(kw => title.includes(kw));
}

// ============================================================
// 判定レベル定義（稼働負荷ベース）
// ============================================================
const LEVEL_DEFINITIONS = [
  { level: 1, name: '余力あり',         maxHours: 20,       color: '#6ee7b7', bgColor: '#ecfdf5', textColor: '#065f46', emoji: '🟢' },
  { level: 2, name: '通常運転',         maxHours: 35,       color: '#10b981', bgColor: '#d1fae5', textColor: '#064e3b', emoji: '🔵' },
  { level: 3, name: '入れすぎ注意',     maxHours: 44,       color: '#fbbf24', bgColor: '#fffbeb', textColor: '#92400e', emoji: '⚠️' },
  { level: 4, name: '追加予定NG',       maxHours: 49,       color: '#f97316', bgColor: '#fff7ed', textColor: '#7c2d12', emoji: '🟠' },
  { level: 5, name: '回復日を強制確保', maxHours: Infinity, color: '#ef4444', bgColor: '#fef2f2', textColor: '#7f1d1d', emoji: '🚨' },
];

function getLevel(loadHours) {
  return LEVEL_DEFINITIONS.find(def => loadHours <= def.maxHours);
}

// ============================================================
// 日付ユーティリティ（翌日計算）
// ============================================================
function getNextDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// ============================================================
// 二日酔いロス判定
// ============================================================
const HANGOVER_LOSS_HOURS = 5;

/**
 * @param {object[]} allItems - schedule.json の全アイテム
 * @param {Map<string, object[]>} dayMap - 日付→アイテム[]
 * @returns {object[]} アラートリスト（週割り当て用の drinkDate を含む）
 */
function analyzeDrinking(allItems, dayMap) {
  const alerts = [];
  const processedDates = new Set(); // 同日複数の飲酒予定は1回だけ処理

  for (const item of allItems) {
    if (!isDrinkingEvent(item.title)) continue;
    if (processedDates.has(item.date)) continue;
    processedDates.add(item.date);

    const nextDate = getNextDateStr(item.date);
    const nextDayItems = dayMap.get(nextDate) || [];

    const nextDaySelfInvest = nextDayItems.filter(i => isSelfInvestEvent(i.title));
    const nextDayMorning    = nextDayItems.filter(i => i.startHour != null && i.startHour < 12);
    const nextDayTotalHours = nextDayItems.reduce((s, i) => s + i.hours, 0);
    const nextDayHeavy      = nextDayTotalHours > 5;

    let riskType;
    let message;

    if (nextDaySelfInvest.length > 0) {
      const titles = nextDaySelfInvest.map(i => i.title).join('・');
      riskType = 'self_invest_conflict';
      message  = `🍺 「${item.title}」の翌日（${nextDate}）に${titles}が入っています。翌朝の重要タスクは午後以降にずらすのがおすすめです。`;
    } else if (nextDayMorning.length > 0 || nextDayHeavy) {
      riskType = 'morning_busy';
      message  = `🍺 「${item.title}」の翌日（${nextDate}）は朝から予定が入っています。翌${HANGOVER_LOSS_HOURS}hのロスを想定して、朝の予定は軽めに調整してください。`;
    } else {
      riskType = 'caution';
      message  = `🍺 翌${HANGOVER_LOSS_HOURS}hロス想定：「${item.title}」の翌日は回復日として設計するのがおすすめです。`;
    }

    alerts.push({
      drinkDate:      item.date,
      drinkTitle:     item.title,
      nextDate,
      riskType,
      conflictTitles: nextDaySelfInvest.map(i => i.title),
      message,
    });
  }

  return alerts;
}

// ============================================================
// 自己投資時間分析
// ============================================================

/**
 * @param {object[]} weekItems - その週のアイテム[]
 * @param {string}   weekStart - 週の開始日 (YYYY-MM-DD, 月曜)
 * @param {string}   weekEnd   - 週の終了日 (YYYY-MM-DD, 日曜)
 * @param {boolean}  isHighLoad - ライブ週や回復週などの免除フラグ
 */
function analyzeSelfInvestment(weekItems, weekStart, weekEnd, isHighLoad) {
  const investItems = weekItems.filter(i => isSelfInvestEvent(i.title));
  const totalHours  = Math.round(investItems.reduce((s, i) => s + i.hours, 0) * 10) / 10;

  // 平日の連続ギャップ計算（週内のみ）
  const datesWithInvest = new Set(investItems.map(i => i.date));
  const [sy, sm, sd] = weekStart.split('-').map(Number);
  const [ey, em, ed] = weekEnd.split('-').map(Number);
  let maxGap = 0;
  let currentGap = 0;
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const endDt = new Date(Date.UTC(ey, em - 1, ed));

  while (cur <= endDt) {
    const dow     = cur.getUTCDay();
    const dateStr = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6) { // 平日のみカウント
      if (!datesWithInvest.has(dateStr)) {
        currentGap++;
        maxGap = Math.max(maxGap, currentGap);
      } else {
        currentGap = 0;
      }
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const isDeficient      = totalHours < 5;
  const isCritical       = totalHours < 3;
  const hasConsecutiveGap = maxGap >= 3;
  const level            = totalHours >= 5 ? 'ok' : totalHours >= 3 ? 'low' : 'critical';

  // ライブ週・回復週は注意文をやわらかくする
  const softMode = isHighLoad;

  return {
    totalHours,
    level,
    isDeficient,
    isCritical,
    hasConsecutiveGap,
    gapMaxDays: maxGap,
    softMode,
    items: investItems.map(i => ({ title: i.title, hours: i.hours, date: i.date })),
  };
}

// ============================================================
// 一言コメント生成（優先順位：稼働負荷 > 回復 > 二日酔い > 自己投資）
// ============================================================
function generateRecommendation(weeks, globalHangoverAlerts, selfInvestSummary) {
  const maxLevel      = Math.max(...weeks.map(w => w.level));
  const dangerWeeks   = weeks.filter(w => w.level >= 5);
  const alertWeeks    = weeks.filter(w => w.level >= 3);
  const noRecoveryAlertWeeks = alertWeeks.filter(w => !w.hasRecovery);
  const conflictAlerts = globalHangoverAlerts.filter(a => a.riskType === 'self_invest_conflict');
  const parts = [];

  // Priority 1: 稼働負荷
  if (maxLevel >= 5) {
    const labels = dangerWeeks.slice(0, 2).map(w => w.label).join('、');
    parts.push(`🚨 ${labels}は過負荷状態です。今すぐカレンダーを見直し、最低1日の回復日を確保してください`);
  } else if (maxLevel === 4) {
    const labels = weeks.filter(w => w.level >= 4).slice(0, 2).map(w => w.label).join('、');
    parts.push(`${labels}は稼働負荷が高く、新規予定の追加を避けてください`);
  } else if (maxLevel === 3) {
    parts.push(`${alertWeeks.length}週で稼働負荷が高めです。重要度の低い予定は別の週に分散させてください`);
  }

  // Priority 2: 回復予定不足
  if (noRecoveryAlertWeeks.length > 0) {
    parts.push(`高負荷週に回復予定がない週が${noRecoveryAlertWeeks.length}週あります。意識的に回復日をカレンダーへ入れてください`);
  }

  // Priority 3: 二日酔いロス
  if (conflictAlerts.length > 0) {
    parts.push(`飲酒翌日に重要タスクが${conflictAlerts.length}件重なっています。翌朝の予定は午後以降にずらすのがおすすめです`);
  } else if (globalHangoverAlerts.length > 0) {
    parts.push(`飲酒予定が${globalHangoverAlerts.length}件あります。翌日${HANGOVER_LOSS_HOURS}h分の回復時間を見込んでおいてください`);
  }

  // Priority 4: 自己投資不足
  if (selfInvestSummary.weeksCritical >= 3) {
    parts.push(`自己投資時間が極めて少ない週が${selfInvestSummary.weeksCritical}週あります。AI学習・制作・練習を先にカレンダーへ入れてください`);
  } else if (selfInvestSummary.weeksDeficient > 4) {
    parts.push(`多くの週で自己投資時間が不足しています。1日15分からでも自己投資タスクを確保しましょう`);
  } else if (selfInvestSummary.weeksDeficient > 0) {
    parts.push(`一部の週で自己投資時間が少なめです。AI学習かSNS制作を先にカレンダーへ入れてみてください`);
  }

  if (parts.length === 0) {
    const investNote = selfInvestSummary.totalHours > 0
      ? `自己投資も週${(selfInvestSummary.totalHours / 13).toFixed(1)}h確保できています。`
      : '';
    return `今後13週間はバランスよく設計できています。${investNote}このペースを維持していきましょう。`;
  }

  return parts.join('。また、') + '。';
}

// ============================================================
// メイン処理
// ============================================================
function main() {
  console.log('=== calc-workload.js 開始 ===');
  console.log(`入力: ${inputPath}`);
  console.log(`出力: ${outputPath}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 入力ファイルが見つかりません: ${inputPath}`);
    console.error('先に get-calendar.js または get-schedule.js を実行してください。');
    process.exit(1);
  }

  const raw   = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const items = raw.items || [];
  console.log(`読み込み: ${items.length} 件のスケジュール`);

  // 今日から13週分の週リストを取得
  const weeks = getWeeksFromToday(13);
  const weekIndexByMonday = new Map();
  weeks.forEach((w, i) => weekIndexByMonday.set(w.start, i));

  // 全アイテムの日付→アイテム[] マップ（二日酔い翌日検索用）
  const dayMap = new Map();
  for (const item of items) {
    if (!dayMap.has(item.date)) dayMap.set(item.date, []);
    dayMap.get(item.date).push(item);
  }

  // 週ごとの集計データを初期化
  const weekData = weeks.map(w => ({
    ...w,
    totalHours:      0,
    totalLoadHours:  0,
    hasRecovery:     false,
    items:           [],
    level:           1,
    levelName:       '余力あり',
    levelColor:      '#6ee7b7',
    levelBgColor:    '#ecfdf5',
    levelTextColor:  '#065f46',
    levelEmoji:      '🟢',
    hanoverAlerts:   [],   // 二日酔いロスアラート
    selfInvestment:  null, // 自己投資分析（後で設定）
  }));

  // アイテムを週ごとに振り分けて集計
  let skippedCount = 0;
  for (const item of items) {
    const weekMonday = getWeekMonday(item.date);
    const idx = weekIndexByMonday.get(weekMonday);
    if (idx === undefined) {
      skippedCount++;
      continue;
    }

    const kwMatch   = matchKeyword(item.title);
    const loadHours = Math.round(item.hours * kwMatch.multiplier * 100) / 100;

    const enrichedItem = {
      ...item,
      multiplier:   kwMatch.multiplier,
      loadHours,
      keywordLabel: kwMatch.label,
      isRecovery:   kwMatch.isRecovery,
    };

    weekData[idx].totalHours     += item.hours;
    weekData[idx].totalLoadHours += loadHours;
    if (kwMatch.isRecovery) weekData[idx].hasRecovery = true;
    weekData[idx].items.push(enrichedItem);
  }

  if (skippedCount > 0) {
    console.log(`${skippedCount} 件のアイテムが13週範囲外のためスキップされました`);
  }

  // 判定レベルを付与（稼働負荷ベース）
  weekData.forEach(w => {
    w.totalHours     = Math.round(w.totalHours     * 10) / 10;
    w.totalLoadHours = Math.round(w.totalLoadHours * 10) / 10;

    const levelDef    = getLevel(w.totalLoadHours);
    w.level           = levelDef.level;
    w.levelName       = levelDef.name;
    w.levelColor      = levelDef.color;
    w.levelBgColor    = levelDef.bgColor;
    w.levelTextColor  = levelDef.textColor;
    w.levelEmoji      = levelDef.emoji;
  });

  // ── 二日酔いロス判定 ────────────────────────────────────────
  const globalHangoverAlerts = analyzeDrinking(items, dayMap);

  // 各アラートを対応する週に紐づける
  for (const alert of globalHangoverAlerts) {
    const weekMonday = getWeekMonday(alert.drinkDate);
    const idx = weekIndexByMonday.get(weekMonday);
    if (idx !== undefined) {
      weekData[idx].hanoverAlerts.push(alert);
    }
  }

  // ── 自己投資分析 ────────────────────────────────────────────
  weekData.forEach(w => {
    // ライブ本番週・高負荷週・回復週は softMode=true
    const isHighLoad = w.level >= 4 || w.hasRecovery ||
      w.items.some(i => i.title.includes('ライブ') || i.title.includes('本番'));
    w.selfInvestment = analyzeSelfInvestment(w.items, w.start, w.end, isHighLoad);
  });

  // 自己投資サマリー
  const selfInvestSummary = {
    weeksDeficient:   weekData.filter(w => w.selfInvestment.isDeficient).length,
    weeksCritical:    weekData.filter(w => w.selfInvestment.isCritical).length,
    totalHours:       Math.round(weekData.reduce((s, w) => s + w.selfInvestment.totalHours, 0) * 10) / 10,
    weeklyAvgHours:   0,
    futureIncomeRisk: false,
  };
  selfInvestSummary.weeklyAvgHours = Math.round(selfInvestSummary.totalHours / 13 * 10) / 10;
  selfInvestSummary.futureIncomeRisk =
    selfInvestSummary.weeksCritical >= 3 ||
    (selfInvestSummary.weeksDeficient >= 7 && selfInvestSummary.totalHours < 20);

  // ── 危険週 TOP3 ──────────────────────────────────────────────
  const topDangerWeeks = [...weekData]
    .filter(w => w.level >= 3)
    .sort((a, b) => b.level - a.level || b.totalLoadHours - a.totalLoadHours)
    .slice(0, 3);

  const maxLoadHoursForBar = Math.max(50, ...weekData.map(w => w.totalLoadHours));
  const today       = getTodayJST();
  const currentWeek = weekData.find(w => w.isCurrentWeek) || weekData[0];
  const alertWeeks  = weekData.filter(w => w.level >= 3);
  const maxLevel    = Math.max(...weekData.map(w => w.level));
  const recommendation = generateRecommendation(weekData, globalHangoverAlerts, selfInvestSummary);

  const totalAllLoad = weekData.reduce((sum, w) => sum + w.totalLoadHours, 0);
  if (totalAllLoad === 0) {
    console.warn('⚠️  警告: 集計対象のデータが0件です。カレンダーのデータを確認してください。');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    today,
    config: { weeksCount: 13, maxLoadHoursForBar },
    currentWeek,
    weeks: weekData,
    topDangerWeeks,
    summary: {
      totalAlertWeeks:        alertWeeks.length,
      maxLevel,
      maxLevelName:           LEVEL_DEFINITIONS.find(d => d.level === maxLevel)?.name || '',
      totalLoadHoursAllWeeks: Math.round(totalAllLoad * 10) / 10,
      totalHoursAllWeeks:     Math.round(weekData.reduce((s, w) => s + w.totalHours, 0) * 10) / 10,
    },
    alerts: {
      hangover: {
        totalAlerts:    globalHangoverAlerts.length,
        conflictAlerts: globalHangoverAlerts.filter(a => a.riskType === 'self_invest_conflict').length,
        weeksAffected:  weekData.filter(w => w.hanoverAlerts.length > 0).length,
        items:          globalHangoverAlerts,
      },
      selfInvestment: selfInvestSummary,
    },
    recommendation,
  };

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

  // ── コンソール出力 ───────────────────────────────────────────
  console.log('');
  console.log('=== 集計結果（稼働負荷 / 拘束時間） ===');
  console.log(`今週 (${currentWeek.label}): 稼働${currentWeek.totalLoadHours}h / 拘束${currentWeek.totalHours}h → ${currentWeek.levelEmoji} ${currentWeek.levelName}`);
  console.log(`アラート週（レベル3以上）: ${alertWeeks.length}週`);
  console.log(`二日酔いロスアラート: ${globalHangoverAlerts.length}件`);
  console.log(`自己投資不足週: ${selfInvestSummary.weeksDeficient}週 (うち深刻: ${selfInvestSummary.weeksCritical}週)`);
  console.log('');
  weekData.forEach(w => {
    const bar         = '█'.repeat(Math.min(Math.round(w.totalLoadHours / 2), 20));
    const marker      = w.isCurrentWeek ? '▶' : ' ';
    const recovery    = w.hasRecovery ? ' 🛁' : '';
    const drinking    = w.hanoverAlerts.length > 0 ? ' 🍺' : '';
    const selfInvest  = w.selfInvestment?.isDeficient ? ' 📚' : '';
    console.log(`${marker} W${String(w.weekNumber).padStart(2)} ${w.label.padEnd(12)} ${bar.padEnd(20)} 稼働${String(w.totalLoadHours).padStart(5)}h / 拘束${String(w.totalHours).padStart(5)}h ${w.levelEmoji}${recovery}${drinking}${selfInvest}`);
  });
  console.log('');
  console.log(`✅ ${outputPath} に書き出しました`);
}

main();
