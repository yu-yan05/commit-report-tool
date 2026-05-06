#!/usr/bin/env node
/**
 * Googleスプレッドシート読み取りスクリプト
 *
 * A列: 日付, B列: タイトル, C列: 工数（時間）を読み取り
 * /tmp/schedule.json に出力する
 *
 * Usage:
 *   node scripts/get-schedule.js               # 本番（Google Sheets API）
 *   node scripts/get-schedule.js --mock        # モックデータで動作確認
 *   node scripts/get-schedule.js --output path # 出力先を変更（デフォルト: /tmp/schedule.json）
 *
 * Required env vars (本番時):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  サービスアカウントJSONのBase64エンコード
 *   SPREADSHEET_ID               スプレッドシートのID
 */

// ローカル開発時は .env ファイルから環境変数を読み込む（本番・CI では不要）
try { require('dotenv').config(); } catch {}

const fs = require('fs');
const path = require('path');
const { normalizeDate, getTodayJST } = require('./lib/date-utils');

// ============================================================
// 引数パース
// ============================================================
const args = process.argv.slice(2);
const useMock = args.includes('--mock');
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : '/tmp/schedule.json';

// ============================================================
// モックデータ生成
// ============================================================
function generateMockData() {
  const today = getTodayJST();
  const [ty, tm, td] = today.split('-').map(Number);

  const items = [];
  const categories = ['クライアントMTG', '資料作成', '社内MTG', '開発作業', 'レビュー', '営業対応', 'ワークショップ', '勉強会'];

  // 今日から91日分（13週）のランダムなスケジュールを生成
  for (let i = 0; i < 91; i++) {
    const date = new Date(Date.UTC(ty, tm - 1, td));
    date.setUTCDate(date.getUTCDate() + i);
    const dateStr = date.toISOString().slice(0, 10);

    // 土日は予定を少なくする
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) {
      if (Math.random() > 0.1) continue;
    }

    // 1日あたり0〜4件の予定
    const taskCount = Math.floor(Math.random() * 5);
    for (let j = 0; j < taskCount; j++) {
      const title = categories[Math.floor(Math.random() * categories.length)];
      // 0.5h〜4hの工数
      const hours = Math.round((0.5 + Math.random() * 3.5) * 2) / 2;
      items.push({ date: dateStr, title, hours });
    }
  }

  // いくつかの週に意図的に高負荷を入れる（アラートが出るように）
  const heavyWeeks = [2, 5, 8]; // 第2、5、8週を高負荷に
  for (const weekOffset of heavyWeeks) {
    const monday = new Date(Date.UTC(ty, tm - 1, td));
    // 今週の月曜日を基点にする
    const dow = monday.getUTCDay();
    const daysToMonday = dow === 0 ? -6 : 1 - dow;
    monday.setUTCDate(monday.getUTCDate() + daysToMonday + (weekOffset - 1) * 7);

    for (let d = 0; d < 5; d++) {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + d);
      const dateStr = date.toISOString().slice(0, 10);

      items.push({ date: dateStr, title: '重要プロジェクト作業', hours: 6 });
      items.push({ date: dateStr, title: 'クライアントMTG', hours: 2 });
      if (weekOffset === 5) {
        items.push({ date: dateStr, title: '追加対応', hours: 3 });
      }
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// Google Sheets API 読み取り
// ============================================================
async function fetchFromSheets() {
  const serviceAccountB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'Sheet1';

  if (!serviceAccountB64) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON 環境変数が設定されていません。\n' +
      'サービスアカウントのJSONをBase64エンコードして設定してください。\n' +
      'ローカルテストには --mock フラグを使用してください。'
    );
  }
  if (!spreadsheetId) {
    throw new Error(
      'SPREADSHEET_ID 環境変数が設定されていません。\n' +
      'スプレッドシートのURLから ID を取得して設定してください。'
    );
  }

  const { google } = require('googleapis');
  const credentials = JSON.parse(
    Buffer.from(serviceAccountB64, 'base64').toString('utf8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  let values;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A:C`,
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      values = response.data.values;
      break;
    } catch (err) {
      const isRetryable = err.code === 429 || (err.code >= 500 && err.code < 600);
      if (isRetryable && attempt < 2) {
        const waitMs = Math.pow(2, attempt) * 1000;
        console.log(`レート制限または一時エラー。${waitMs}ms後にリトライ...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }

  const rows = values || [];
  const dataRows = rows.slice(1); // ヘッダー行をスキップ

  return dataRows
    .filter(row => row[0]?.trim()) // 日付が空の行を除外
    .map(row => ({
      date: normalizeDate(row[0]),
      title: row[1]?.trim() || '(無題)',
      hours: parseFloat(row[2]) || 0,
    }))
    .filter(item => item.date !== null && item.hours > 0);
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log('=== get-schedule.js 開始 ===');
  console.log(`モード: ${useMock ? 'モック' : 'Google Sheets API'}`);
  console.log(`出力先: ${outputPath}`);

  let items;

  if (useMock) {
    console.log('モックデータを生成中...');
    items = generateMockData();
    console.log(`生成完了: ${items.length} 件`);
  } else {
    console.log('Google Sheets APIからデータを取得中...');
    items = await fetchFromSheets();
    console.log(`取得完了: ${items.length} 件`);
  }

  // 出力先ディレクトリを作成
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    source: useMock ? 'mock' : 'google_sheets',
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
