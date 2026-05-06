/**
 * 日付・週計算ユーティリティ
 *
 * すべての計算はUTCベースで行い、JST(+9)を明示的に加算する。
 * GitHub ActionsのランナーはデフォルトUTCのため、
 * getDay()/getDate()等のローカル依存メソッドは使わない。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 今日のJST日付文字列を返す（YYYY-MM-DD）
 */
function getTodayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/**
 * 日付文字列（YYYY-MM-DD）を受け取り、その週の月曜日（JST）を返す
 * 日曜始まりの週でも月曜始まりに補正する
 */
function getWeekMonday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=日, 1=月, ..., 6=土
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + daysToMonday);
  return date.toISOString().slice(0, 10);
}

/**
 * 週の月曜日から日曜日の日付文字列を返す
 */
function getWeekSunday(mondayStr) {
  const [y, m, d] = mondayStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

/**
 * 今日から numWeeks 週分の週リストを返す
 * 第1週は今日を含む週（その週の月曜日から）
 *
 * @param {number} numWeeks - 取得する週数（デフォルト13）
 * @returns {Array<{weekNumber, start, end, label, shortLabel}>}
 */
function getWeeksFromToday(numWeeks = 13) {
  const today = getTodayJST();
  const [ty, tm, td] = today.split('-').map(Number);
  const todayUTC = new Date(Date.UTC(ty, tm - 1, td));
  const todayDow = todayUTC.getUTCDay(); // 0=日

  // 日曜日の場合は翌日（月曜）を「今週」の開始として扱う
  let thisMonday;
  if (todayDow === 0) {
    const nextDay = new Date(todayUTC);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    thisMonday = nextDay.toISOString().slice(0, 10);
  } else {
    thisMonday = getWeekMonday(today);
  }

  const weeks = [];
  for (let i = 0; i < numWeeks; i++) {
    const [y, m, d] = thisMonday.split('-').map(Number);
    const monday = new Date(Date.UTC(y, m - 1, d));
    monday.setUTCDate(monday.getUTCDate() + i * 7);

    const start = monday.toISOString().slice(0, 10);
    const end = getWeekSunday(start);

    const [sy, sm, sd] = start.split('-').map(Number);
    const [, em, ed] = end.split('-').map(Number);

    weeks.push({
      weekNumber: i + 1,
      start,
      end,
      label: `${sm}/${sd}〜${em}/${ed}`,
      shortLabel: `${sm}/${sd}〜`,
      isCurrentWeek: i === 0,
    });
  }

  return weeks;
}

/**
 * 日付文字列の正規化（様々なフォーマットを YYYY-MM-DD に統一）
 * Googleスプレッドシートからの入力揺れに対応する
 */
function normalizeDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  // Googleシートの日付シリアル値（整数5桁）
  if (/^\d{4,5}$/.test(str)) {
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + parseInt(str, 10));
    return epoch.toISOString().slice(0, 10);
  }

  // スラッシュ区切り → ハイフン区切りに変換
  const normalized = str.replace(/\//g, '-');

  // YYYY-MM-DD or YYYY-M-D
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

module.exports = {
  getTodayJST,
  getWeekMonday,
  getWeekSunday,
  getWeeksFromToday,
  normalizeDate,
};
