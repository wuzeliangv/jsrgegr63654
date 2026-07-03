// 地区 emoji 映射（统一数据源，供 deploy.js / tgbot.js 共用）
const REGION_EMOJI = {
  'singapore': '🇸🇬', '新加坡': '🇸🇬',
  'tokyo': '🇯🇵', 'japan': '🇯🇵', 'osaka': '🇯🇵', 'chiyoda': '🇯🇵', '东京': '🇯🇵', '大阪': '🇯🇵', '千代田': '🇯🇵', '日本': '🇯🇵',
  'seoul': '🇰🇷', 'korea': '🇰🇷', '首尔': '🇰🇷', '韩国': '🇰🇷',
  'hong kong': '🇭🇰', 'hongkong': '🇭🇰', '香港': '🇭🇰',
  'taiwan': '🇹🇼', 'taipei': '🇹🇼', '台湾': '🇹🇼', '台北': '🇹🇼',
  'mumbai': '🇮🇳', 'india': '🇮🇳', '孟买': '🇮🇳', '印度': '🇮🇳',
  'sydney': '🇦🇺', 'australia': '🇦🇺', '悉尼': '🇦🇺', '澳大利亚': '🇦🇺',
  'london': '🇬🇧', 'uk': '🇬🇧', 'united kingdom': '🇬🇧', '伦敦': '🇬🇧', '英国': '🇬🇧',
  'frankfurt': '🇩🇪', 'germany': '🇩🇪', '法兰克福': '🇩🇪', '德国': '🇩🇪',
  'paris': '🇫🇷', 'france': '🇫🇷', '巴黎': '🇫🇷', '法国': '🇫🇷',
  'amsterdam': '🇳🇱', 'netherlands': '🇳🇱', '阿姆斯特丹': '🇳🇱', '荷兰': '🇳🇱',
  'virginia': '🇺🇸', 'ohio': '🇺🇸', 'oregon': '🇺🇸', 'california': '🇺🇸', 'portland': '🇺🇸', 'minkler': '🇺🇸', 'ashburn': '🇺🇸', 'san jose': '🇺🇸', 'santa clara': '🇺🇸',
  'los angeles': '🇺🇸', '洛杉矶': '🇺🇸',
  'us': '🇺🇸', 'united states': '🇺🇸', 'america': '🇺🇸', '美国': '🇺🇸', '弗吉尼亚': '🇺🇸', '俄亥俄': '🇺🇸', '俄勒冈': '🇺🇸', '波特兰': '🇺🇸', '明克勒': '🇺🇸', '阿什本': '🇺🇸', '圣何塞': '🇺🇸', '圣克拉拉': '🇺🇸',
  'vietnam': '🇻🇳', 'hanoi': '🇻🇳', 'ho chi minh': '🇻🇳', 'ho chi minh city': '🇻🇳', 'da nang': '🇻🇳', '越南': '🇻🇳', '河内': '🇻🇳', '胡志明': '🇻🇳', '岘港': '🇻🇳',
  'canada': '🇨🇦', 'toronto': '🇨🇦', '加拿大': '🇨🇦', '多伦多': '🇨🇦',
  'brazil': '🇧🇷', 'são paulo': '🇧🇷', 'sao paulo': '🇧🇷', '巴西': '🇧🇷', '圣保罗': '🇧🇷',
  'jakarta': '🇮🇩', 'indonesia': '🇮🇩', '雅加达': '🇮🇩', '印尼': '🇮🇩', '印度尼西亚': '🇮🇩',
  'bangkok': '🇹🇭', 'thailand': '🇹🇭', '曼谷': '🇹🇭', '泰国': '🇹🇭',
  'kuala lumpur': '🇲🇾', 'malaysia': '🇲🇾', '吉隆坡': '🇲🇾', '马来西亚': '🇲🇾',
  'manila': '🇵🇭', 'philippines': '🇵🇭', '马尼拉': '🇵🇭', '菲律宾': '🇵🇭',
  'dubai': '🇦🇪', '迪拜': '🇦🇪',
  'bahrain': '🇧🇭', '巴林': '🇧🇭',
  'stockholm': '🇸🇪', 'sweden': '🇸🇪', '斯德哥尔摩': '🇸🇪', '瑞典': '🇸🇪',
  'dublin': '🇮🇪', 'ireland': '🇮🇪', '都柏林': '🇮🇪', '爱尔兰': '🇮🇪',
  'milan': '🇮🇹', 'italy': '🇮🇹', '米兰': '🇮🇹', '意大利': '🇮🇹',
  'zurich': '🇨🇭', 'switzerland': '🇨🇭', '苏黎世': '🇨🇭', '瑞士': '🇨🇭',
  'warsaw': '🇵🇱', 'poland': '🇵🇱', '华沙': '🇵🇱', '波兰': '🇵🇱',
  'cape town': '🇿🇦', 'south africa': '🇿🇦', '开普敦': '🇿🇦', '南非': '🇿🇦',
};

const CITY_CN = {
  'singapore': '新加坡', 'tokyo': '东京', 'osaka': '大阪', 'chiyoda': '千代田', 'chiyoda city': '千代田',
  'seoul': '首尔', 'hong kong': '香港', 'hongkong': '香港',
  'taipei': '台北', 'mumbai': '孟买', 'sydney': '悉尼',
  'london': '伦敦', 'frankfurt': '法兰克福', 'paris': '巴黎',
  'amsterdam': '阿姆斯特丹', 'virginia': '弗吉尼亚', 'ohio': '俄亥俄',
  'oregon': '俄勒冈', 'california': '加利福尼亚', 'los angeles': '洛杉矶', 'portland': '波特兰', 'minkler': '明克勒', 'ashburn': '阿什本', 'san jose': '圣何塞', 'santa clara': '圣克拉拉', 'são paulo': '圣保罗',
  'toronto': '多伦多', 'jakarta': '雅加达', 'bangkok': '曼谷',
  'kuala lumpur': '吉隆坡', 'manila': '马尼拉',
  'dubai': '迪拜', 'stockholm': '斯德哥尔摩', 'dublin': '都柏林',
  'milan': '米兰', 'zurich': '苏黎世', 'warsaw': '华沙',
  'cape town': '开普敦', 'bahrain': '巴林',
  'hanoi': '河内', 'ho chi minh': '胡志明', 'ho chi minh city': '胡志明', 'da nang': '岘港',
};

function getRegionEmoji(text) {
  const key = String(text || '').toLowerCase();
  for (const [k, v] of Object.entries(REGION_EMOJI)) {
    if (key.includes(k)) return v;
  }
  return '🌐';
}

function getCityCN(city) {
  const key = (city || '').toLowerCase();
  for (const [k, v] of Object.entries(CITY_CN)) {
    if (key.includes(k)) return v;
  }
  return city || '未知';
}

module.exports = { REGION_EMOJI, CITY_CN, getRegionEmoji, getCityCN };
