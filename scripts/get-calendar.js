#!/usr/bin/env node
/**
 * Google カレンダー読み取りスクリプト
 *
 * 今日から13週間先までのGoogleカレンダー予定を取得し
 * /tmp/schedule.json に出力する（calc-workload.js と互換のフォーマット）
 *
 * Usage:
 *   node scripts/get-calendar.js               # 本番（Google Calendar API）
 *   node scripts/get-calendar.js --mock        # モックデータで動作確認
 *   node scripts/get-calendar.js --output path # 出力先を変更
 *
 * Required env vars (本番時):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  サービスアカウントJSONのBase64エンコード
 *   GOOGLE_CALENDAR_ID           カレンダーID（省略時: primary）
 *   ALL_DAY_HOURS                終日イベント1日あたりの換算時間（省略時: 8）
 */

// ローカル開発時は .env ファイルから環境変数を読み込む
try { require('dotenv').config(); } catch {}

const fs = require('fs');
const path = require('path');
const { getTodayJST, getWeeksFromToday } = require('./lib/date-utils');

// ============================================================
// 定数・設定
// ============================================================
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKS = 13;

const args = process.argv.slice(2);
const useMock = args.includes('--mock');
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : '/tmp/schedule.json';

// 終日イベント1日あたりの換算時間（環境変数で上書き可能）
const ALL_DAY_HOURS = parseFloat(process.env.ALL_DAY_HOURS || '8');

// ============================================================
// 日付・時間ユーティリティ
// ============================================================

/** UTC datetimeをJSTの日付文字列（YYYY-MM-DD）に変換 */
function toJSTDateStr(utcDate) {
  const jst = new Date(utcDate.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/** UTC datetimeをJSTの時（0-23）に変換 */
function toJSTHour(utcDate) {
  const jst = new Date(utcDate.getTime() + JST_OFFSET_MS);
  return jst.getUTCHours();
}

/** タイムドイベントの所要時間（時間）を計算 */
function calcTimedHours(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const hours = (end - start) / (1000 * 60 * 60);
  return Math.round(hours * 100) / 100;
}

/**
 * 終日イベントを1日ずつ展開してアイテム配列を返す
 * 例: 5/10〜5/13 の3泊イベント → 5/10, 5/11, 5/12 の3件
 * ※ Google Calendar の end.date は「終了日の翌日」なので注意
 */
function expandAllDayEvent(title, startDateStr, endDateStr) {
  const items = [];
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);

  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed)); // 終了日（この日は含まない）

  let current = new Date(start);
  while (current < end) {
    items.push({
      date: current.toISOString().slice(0, 10),
      title,
      hours: ALL_DAY_HOURS,
      isAllDay: true,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return items;
}

// ============================================================
// モックデータ生成
// ============================================================

/** 日付オフセットのユーティリティ */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function generateMockData() {
  const weeks = getWeeksFromToday(WEEKS);
  const rangeStart = weeks[0].start;
  const rangeEnd = weeks[WEEKS - 1].end;

  const items = [];

  // ── ベースライン：平日にランダムイベントを生成 ─────────────────
  const baseEvents = [
    { title: 'クライアントMTG',   hours: 1.5, startHour: 10 },
    { title: '社内定例',          hours: 1,   startHour: 15 },
    { title: 'プロジェクト作業',  hours: 3,   startHour: 13 },
    { title: '資料作成',          hours: 2,   startHour: 14 },
    { title: 'レビュー対応',      hours: 1,   startHour: 16 },
    { title: '1on1',              hours: 0.5, startHour: 11 },
    { title: 'ワークショップ',    hours: 3,   startHour: 13 },
    { title: '移動',              hours: 1.5, startHour: 12 },
    { title: '夜仕事',            hours: 2,   startHour: 20 },
  ];
  const recoveryBase = [
    { title: 'サウナ',   hours: 2,   startHour: null },
    { title: '美容院',   hours: 2,   startHour: null },
    { title: 'マッサージ', hours: 1, startHour: null },
    { title: 'ジム',     hours: 1.5, startHour: null },
  ];

  const [rsy, rsm, rsd] = rangeStart.split('-').map(Number);
  const current = new Date(Date.UTC(rsy, rsm - 1, rsd));
  const [rey, rem, red] = rangeEnd.split('-').map(Number);
  const end = new Date(Date.UTC(rey, rem - 1, red));

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const dow = current.getUTCDay();

    if (dow !== 0 && dow !== 6) {
      const count = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < count; i++) {
        const t = baseEvents[Math.floor(Math.random() * baseEvents.length)];
        items.push({ date: dateStr, title: t.title, hours: t.hours, startHour: t.startHour });
      }
    } else if (dow === 6 && Math.random() < 0.3) {
      const t = recoveryBase[Math.floor(Math.random() * recoveryBase.length)];
      items.push({ date: dateStr, title: t.title, hours: t.hours, startHour: t.startHour });
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // ── シナリオ1：第1週（今週）── 飲み会→翌朝AI学習でself_invest_conflict ──
  if (weeks.length >= 1) {
    const w = weeks[0].start;
    // 水曜：飲み会（夜）
    const wed = addDays(w, 2);
    items.push({ date: wed, title: '飲み会', hours: 3, startHour: 20 });
    // 木曜：AI学習（朝）→ 二日酔いロスと競合
    const thu = addDays(w, 3);
    items.push({ date: thu, title: 'AI学習', hours: 2, startHour: 9 });
    items.push({ date: thu, title: 'クライアントMTG', hours: 1.5, startHour: 14 });
    // 自己投資：練習（火）
    const tue = addDays(w, 1);
    items.push({ date: tue, title: '練習', hours: 2, startHour: 10 });
  }

  // ── シナリオ2：第2週 ── 高負荷 + ライブ本番 + 会食→翌日朝から詰まり ──
  if (weeks.length >= 2) {
    const w = weeks[1].start;
    for (let d = 0; d < 5; d++) {
      const dateStr = addDays(w, d);
      items.push({ date: dateStr, title: '重要プロジェクト集中作業', hours: 5,   startHour: 10 });
      items.push({ date: dateStr, title: 'クライアント対応',         hours: 2.5, startHour: 14 });
    }
    // 土曜：ライブ本番
    items.push({ date: addDays(w, 5), title: 'ライブ本番', hours: 4, startHour: 18 });
    // 火曜夜：会食、翌水曜は朝から詰まり → morning_busy
    items.push({ date: addDays(w, 1), title: '会食',       hours: 2,   startHour: 19 });
    items.push({ date: addDays(w, 2), title: '重要プレゼン', hours: 3, startHour: 9 });
    // 自己投資なし → critical deficit
  }

  // ── シナリオ3：第3週 ── ドラム練習+読書で自己投資そこそこ ──
  if (weeks.length >= 3) {
    const w = weeks[2].start;
    items.push({ date: addDays(w, 0), title: 'ドラム練習', hours: 2, startHour: 17 });
    items.push({ date: addDays(w, 2), title: '読書',       hours: 1, startHour: 8 });
    items.push({ date: addDays(w, 4), title: '個人制作',   hours: 2, startHour: 9 });
    // 打ち上げ（夜）→ 翌日は軽め → caution alert
    items.push({ date: addDays(w, 3), title: '打ち上げ',   hours: 2.5, startHour: 20 });
  }

  // ── シナリオ4：第4週 ── 回復メイン + AI学習たっぷり ──
  if (weeks.length >= 4) {
    const w = weeks[3].start;
    items.push({ date: addDays(w, 0), title: '打ち合わせ', hours: 1, startHour: 10 });
    items.push({ date: addDays(w, 2), title: '資料作成',   hours: 2, startHour: 14 });
    items.push({ date: addDays(w, 1), title: 'AI学習',     hours: 3, startHour: 9 });
    items.push({ date: addDays(w, 3), title: 'SNS制作',    hours: 2, startHour: 10 });
    items.push({ date: addDays(w, 4), title: '勉強',       hours: 1.5, startHour: 8 });
    items.push({ date: addDays(w, 5), title: '温泉',       hours: 4, startHour: null });
    items.push({ date: addDays(w, 6), title: '休み',       hours: 8, startHour: null });
  }

  // ── シナリオ5：第5週 ── 超高負荷、自己投資ゼロ ──
  if (weeks.length >= 5) {
    const w = weeks[4].start;
    for (let d = 0; d < 5; d++) {
      const dateStr = addDays(w, d);
      items.push({ date: dateStr, title: '重要プロジェクト集中作業', hours: 5, startHour: 10 });
      items.push({ date: dateStr, title: 'クライアント対応',         hours: 2.5, startHour: 15 });
      items.push({ date: dateStr, title: '追加対応',                 hours: 3, startHour: 18 });
    }
    // 月曜夜：深酒（翌火曜は一日重い） → morning_busy
    items.push({ date: addDays(w, 0), title: '深酒', hours: 3, startHour: 21 });
    // 自己投資なし → critical deficit
  }

  // ── シナリオ6：第6週 ── SNS制作少しだけ、自己投資不足 ──
  if (weeks.length >= 6) {
    const w = weeks[5].start;
    items.push({ date: addDays(w, 2), title: 'SNS制作', hours: 1.5, startHour: 19 });
    // total invest: 1.5h → critical
  }

  // ── シナリオ7：第7週 ── リハ週 + 練習・譜面で自己投資OK ──
  if (weeks.length >= 7) {
    const w = weeks[6].start;
    for (let d = 0; d < 4; d++) {
      items.push({ date: addDays(w, d), title: 'リハ',  hours: 5, startHour: 13 });
    }
    items.push({ date: addDays(w, 0), title: '譜面',    hours: 2, startHour: 9 });
    items.push({ date: addDays(w, 2), title: '練習',    hours: 2, startHour: 8 });
    items.push({ date: addDays(w, 5), title: 'サウナ',  hours: 2, startHour: null });
    items.push({ date: addDays(w, 5), title: '美容院',  hours: 2, startHour: null });
    // 自己投資: 譜面2h + 練習2h = 4h → deficient（ライブ週なので柔らか表示）
  }

  // ── シナリオ8〜13：残週はランダムベースに軽い自己投資を散在 ──
  const selfInvestExtra = ['AI学習', '読書', '個人制作', 'ポートフォリオ', '発信'];
  for (let wi = 7; wi < Math.min(weeks.length, 13); wi++) {
    if (wi === 8 || wi === 10) { // 一部の週に自己投資を追加
      const w = weeks[wi].start;
      const t = selfInvestExtra[wi % selfInvestExtra.length];
      items.push({ date: addDays(w, 1), title: t, hours: 2, startHour: 9 });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// Google Calendar API 読み取り
// ============================================================
async function fetchFromCalendar() {
  const serviceAccountB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  if (!serviceAccountB64) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON 環境変数が設定されていません。\n' +
      'サービスアカウントのJSONをBase64エンコードして設定してください。\n' +
      'ローカルテストには --mock フラグを使用してください。'
    );
  }

  const { google } = require('googleapis');
  const credentials = JSON.parse(
    Buffer.from(serviceAccountB64, 'base64').toString('utf8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // 取得期間：今日（JST 00:00）〜 13週後の日曜（JST 23:59:59）
  const weeks = getWeeksFromToday(WEEKS);
  const rangeStart = weeks[0].start;
  const rangeEnd = weeks[WEEKS - 1].end;

  const [rsy, rsm, rsd] = rangeStart.split('-').map(Number);
  const [rey, rem, red] = rangeEnd.split('-').map(Number);

  // JST 00:00 をUTCに変換（-9h）
  const timeMin = new Date(Date.UTC(rsy, rsm - 1, rsd) - JST_OFFSET_MS).toISOString();
  // JST 23:59:59 をUTCに変換
  const timeMax = new Date(Date.UTC(rey, rem - 1, red, 23, 59, 59) - JST_OFFSET_MS).toISOString();

  console.log(`取得期間: ${rangeStart} 〜 ${rangeEnd} (JST)`);
  console.log(`カレンダーID: ${calendarId}`);

  const items = [];
  let pageToken = undefined;

  // ページネーション対応（2500件/ページ上限）
  do {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,   // 繰り返しイベントを個別に展開
          orderBy: 'startTime',
          maxResults: 2500,
          pageToken,
        });
        break;
      } catch (err) {
        const isRetryable = err.code === 429 || (err.code >= 500 && err.code < 600);
        if (isRetryable && attempt < 2) {
          const waitMs = Math.pow(2, attempt) * 1000;
          console.log(`一時エラー（${err.code}）。${waitMs}ms後にリトライ...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        // 403: カレンダー共有設定を案内
        if (err.code === 403) {
          throw new Error(
            `カレンダーへのアクセスが拒否されました（403）。\n\n` +
            `以下を確認してください:\n` +
            `1. Google Calendar の設定でカレンダーをサービスアカウントと共有しているか\n` +
            `   共有先: ${credentials.client_email}\n` +
            `   権限: 「予定の閲覧（すべての予定の詳細）」以上\n\n` +
            `2. GOOGLE_CALENDAR_ID が正しいか（デフォルト: primary）\n` +
            `   現在の設定: ${calendarId}`
          );
        }
        throw err;
      }
    }

    const events = response.data.items || [];
    console.log(`  取得: ${events.length} 件 (${pageToken ? '続き' : '先頭'})`);

    for (const event of events) {
      // キャンセル済みイベントはスキップ
      if (event.status === 'cancelled') continue;

      const title = event.summary || '(タイトルなし)';

      if (event.start?.dateTime && event.end?.dateTime) {
        // タイムドイベント（時刻指定あり）
        const startDateObj = new Date(event.start.dateTime);
        const hours = calcTimedHours(event.start.dateTime, event.end.dateTime);
        if (hours <= 0) continue;

        const dateStr = toJSTDateStr(startDateObj);
        const startHour = toJSTHour(startDateObj);
        items.push({ date: dateStr, title, hours, startHour });

      } else if (event.start?.date && event.end?.date) {
        // 終日イベント（日付のみ）→ 日ごとに展開
        const dayItems = expandAllDayEvent(title, event.start.date, event.end.date);
        items.push(...dayItems);
      }
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log('=== get-calendar.js 開始 ===');
  console.log(`モード: ${useMock ? 'モック' : 'Google Calendar API'}`);
  console.log(`出力先: ${outputPath}`);
  if (!useMock) {
    console.log(`終日イベント換算: ${ALL_DAY_HOURS}h/日`);
  }

  let items;

  if (useMock) {
    console.log('モックデータを生成中...');
    items = generateMockData();
    console.log(`生成完了: ${items.length} 件`);
  } else {
    console.log('Google Calendar APIからデータを取得中...');
    items = await fetchFromCalendar();
    console.log(`取得完了: ${items.length} 件`);
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    source: useMock ? 'mock_calendar' : 'google_calendar',
    count: items.length,
    items,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`✅ ${outputPath} に書き出しました（${items.length} 件）`);
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
