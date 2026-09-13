// @description Scene pools for the bundled character; pet.config.json scenes overrides individual pools.
export const SCENES = {
  welcome: ["点击回应-元气挥手", "点击回应-挠痒咯咯笑"],
  play: [
    "玩水枪",
    "小提琴演奏",
    "蓝鲸现世",
    "优雅女仆舞",
    "轻快摇摆舞",
    "可爱宅舞",
    "吹气球",
    "动物环绕",
    "放风筝",
    "拆礼物",
    "变鸽子",
    "扑克魔术",
    "抽陀螺",
    "吹笛子",
    "蝴蝶蜜蜂环绕头顶开花",
    "撸猫",
    "凭空生花",
    "骑木马",
    "三球抛接",
    "踢毽子",
    "下五子棋",
    "荡秋千",
    "原地左转奔跑",
  ],
  morning: ["晨间刷牙", "照镜子", "整体换装试色"],
  tidy: ["女仆扫除", "碎碎念-擦桌碎碎念"],
  breakfast: ["吃早餐"],
  lunch: ["吃午餐", "吃盒饭"],
  dinner: ["吃晚餐", "吃白饭"],
  snack: ["大口吃零食", "吃糖葫芦", "吃长寿面", "吃小鱼干"],
  hungry: ["是啊，吃什么", "偷吃零食被抓住"],
  tired: ["迷糊犯困", "睡眼惺忪", "哈欠连天"],
  bored: ["碎碎念-发呆碎碎念", "闲得无聊打游戏"],
  thinking: ["深度思考碎碎念", "碎碎念-对屏碎碎念", "轻快记录"],
  longWork: ["长时间工作看表", "喝奶茶"],
  warm: ["摇扇纳凉", "吃西瓜", "吃冰淇淋融化"],
  cold: ["涮火锅", "喝奶茶"],
  spring: ["吃青团", "放风筝", "蝴蝶蜜蜂环绕头顶开花"],
  summer: ["玩水枪", "吃西瓜", "摇扇纳凉"],
  autumn: ["被落叶淹没", "吃大闸蟹"],
  winter: ["堆雪人", "涮火锅"],
  newYear: ["放烟花", "拆礼物"],
  springFestival: ["吃年糕", "收红包", "写福字", "舞狮头", "吃饺子"],
  lantern: ["吃汤圆", "放孔明灯"],
  dragonBoat: ["吃粽子"],
  qixi: ["穿针乞巧"],
  riverLantern: ["放河灯"],
  midAutumn: ["中秋赏月吃月饼"],
  doubleNinth: ["吃重阳糕", "插茱萸赏菊"],
  laba: ["吃腊八粥"],
  halloween: ["讨糖南瓜灯", "萌化小幽灵"],
  christmas: ["装点圣诞树", "拆礼物"],
  balancePlenty: ["余额-钱袋满溢", "余额-金袋叮当"],
  balanceNormal: ["余额-钱袋如常"],
  balanceLow: ["余额-数金皱眉", "余额-袋空如洗"],
  balanceEmpty: ["余额-分文不剩"],
};

// @description Clips with readable text retain their authored facing.
export const NO_MIRROR = new Set([
  "是啊，吃什么",
  "深度思考碎碎念",
  "写福字",
  "举牌不是大肥鱼",
]);

/**
 * @description Resolve a configurable pool without mutating its shared defaults.
 * @param {object} config Pet configuration.
 * @param {string} key Scene identifier.
 * @returns {string[]} Valid animation names.
 */
export function scenePool(config, key) {
  const value = config?.scenes?.[key] ?? SCENES[key] ?? [];
  return Array.isArray(value)
    ? value.filter((n) => typeof n === "string" && n)
    : [];
}

/**
 * @description Collect playable names from runtime-consumed configuration fields.
 * @param {object} config Pet configuration.
 * @returns {string[]} Unique sorted clip names.
 */
export function animationNames(config) {
  const names = [config.startAnim, config.dragAnim];
  for (const key of ["idle", "action", "long", "click", "sleep", "workBreak"])
    names.push(...(config.pools?.[key] || []));
  for (const value of Object.values(config.state?.map || {}))
    names.push(...(value.anim || []));
  for (const value of Object.values(config.state?.enter || {}))
    names.push(...value);
  names.push(...Object.values(config.ui?.featureAnimations || {}));
  for (const key of Object.keys(SCENES)) names.push(...scenePool(config, key));
  return [...new Set(names.filter(Boolean))].sort();
}
