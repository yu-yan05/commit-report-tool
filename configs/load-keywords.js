/**
 * タイトルキーワード別の稼働負荷倍率
 *
 * - 上から順にタイトルと照合し、最初にマッチしたキーワードの倍率を使用する
 * - どのキーワードにもマッチしない場合は multiplier: 1.0（通常稼働）
 * - isRecovery: true の場合、その週に「回復予定あり 🛁」バッジを表示する
 */
module.exports = [
  // ── 最高負荷 ──────────────────────────────────────
  {
    keywords: ['ライブ', '本番'],
    multiplier: 1.5,
    label: '最高負荷',
    isRecovery: false,
  },
  // ── 高負荷 ────────────────────────────────────────
  {
    keywords: ['飲み会', '会食', '同伴'],
    multiplier: 1.1,
    label: '高負荷',
    isRecovery: false,
  },
  {
    keywords: ['夜仕事', '出勤', 'おむすび'],
    multiplier: 1.2,
    label: '高負荷',
    isRecovery: false,
  },
  {
    keywords: ['リハ'],
    multiplier: 1.2,
    label: '高負荷',
    isRecovery: false,
  },
  // ── 通常稼働 ──────────────────────────────────────
  {
    keywords: ['譜面', 'AI', '作業', '勉強'],
    multiplier: 1.0,
    label: '通常',
    isRecovery: false,
  },
  // ── 軽負荷（拘束はあるが消耗は少ない） ─────────────
  {
    keywords: ['ジム', 'ピラティス', 'トレーニング'],
    multiplier: 0.8,
    label: '軽活動',
    isRecovery: true,
  },
  {
    keywords: ['友達', 'カフェ'],
    multiplier: 0.5,
    label: '軽負荷',
    isRecovery: false,
  },
  // ── 回復・リフレッシュ ────────────────────────────
  {
    keywords: ['美容院', 'ネイル', 'まつげ', 'エステ'],
    multiplier: 0.4,
    label: '回復',
    isRecovery: true,
  },
  {
    keywords: ['温泉', 'サウナ', '岩盤浴', 'マッサージ'],
    multiplier: 0.3,
    label: '回復',
    isRecovery: true,
  },
  // ── 完全休息 ──────────────────────────────────────
  {
    keywords: ['休み', '休息', 'オフ'],
    multiplier: 0,
    label: '休息',
    isRecovery: true,
  },
];
