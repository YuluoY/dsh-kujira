const ACTIVE_STAGES = new Set([
  "thinking",
  "working",
  "reading",
  "searching",
  "editing",
  "testing",
  "delegating",
  "summarizing",
  "retrying",
]);
/**
 * @type {Record<string, string>}
 */
const PHASES = {
  idle: "准备好了",
  thinking: "思考中",
  working: "执行中",
  reading: "读取资料",
  searching: "检索信息",
  editing: "修改文件",
  testing: "运行检查",
  delegating: "分配子任务",
  summarizing: "整理结果",
  retrying: "正在重试",
  waiting: "等待你回应",
  paused: "峰价暂停",
  done: "已完成",
  error: "执行出错",
  stopped: "已停止",
  unknown: "状态待同步",
};
/**
 * @type {Record<string, string>}
 */
const COMPACT = {
  done: "已完成",
  error: "失败",
  stopped: "已停止",
  waiting: "待回应",
  paused: "峰价暂停",
  unknown: "待同步",
  idle: "准备好了",
};
/**
 * @description Identify live execution stages eligible for subtle motion.
 * @param {string} stage Public task stage.
 * @returns {boolean} Whether work is actively progressing.
 */
export function isActiveStage(stage) {
  return ACTIVE_STAGES.has(stage);
}
/**
 * @description Resolve the visible, unambiguous label of a task stage.
 * @param {string} stage Public task stage.
 * @returns {string} Localizable source copy.
 */
export function statusName(stage) {
  return PHASES[stage] || PHASES.unknown;
}
/**
 * @description Resolve a concise row status without implying unknown work is running.
 * @param {string} stage Public task stage.
 * @returns {string} Localizable source copy.
 */
export function compactStatus(stage) {
  return (
    COMPACT[stage] ||
    (isActiveStage(stage) || stage === "running" ? "执行中" : "待同步")
  );
}
/**
 * @description Extract a readable file name from either platform's path format.
 * @param {string} path File path.
 * @returns {string} Last nonempty segment.
 */
export function fileName(path) {
  return path?.split(/[\\/]/).filter(Boolean).pop() || "";
}
