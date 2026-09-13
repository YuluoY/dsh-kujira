/**
 * ============================================================================
 *  lib/shared/arc.js
 * ============================================================================
 *
 *  功能按钮的「圆弧扩散」布局计算 —— 纯函数，零依赖，Node 里可直接单测。
 *
 *  ## 为什么单独抽出来
 *
 *  弧线布局有三个容易出错的地方：角度方向、视口越界、错位延迟的正反向。
 *  这三处都只跟数字有关，跟浏览器无关。抽成纯函数之后，改角度、改半径、
 *  改错位间隔都能用 `npm run test:logic` 立刻验证，不用开浏览器一个个试。
 *
 *  ## 角度约定
 *
 *  一律用**数学角**：0° = 正右（东），逆时针为正，90° = 正上（北），180° = 正左。
 *
 *  屏幕坐标 y 轴向下，所以换算成 CSS 位移时要取负号：
 *
 *      x =  r · cos(θ)
 *      y = -r · sin(θ)        ← 减号在这里，不要漏
 *
 *  这样 θ=90° 得到 (0, -r)，即向上位移 r 像素 —— 符合直觉。
 *
 *  ## 为什么弧线不能随便扫一圈
 *
 *  宠物是贴在视口角落的浮层。如果按钮从圆心向四面八方散开，朝视口外侧
 *  那几个必然被挤到屏幕外甚至触发滚动条。所以有两个硬约束：
 *
 *    1. 弧线的**朝向**必须由宠物当前的可用空间决定（见 pickArcCenter）。
 *    2. 弧线的**跨度**不能太大 —— 4 个按钮扫 72° 时相邻间距约等于按钮直径，
 *       扫到 90° 以上就会开始显得松散、且更容易越界。
 *
 * ============================================================================
 */

/**
 * 弧线预设：朝向 → 中心角。按「优先程度」排序，同分时靠前的优先。
 *
 * 角度按文件头的约定换算，别凭直觉填：
 *
 *     正上 = 90°     左上 = 135°     正左 = 180°
 *     正下 = -90°    右上 = 45°      正右 = 0°
 *
 * 排序理由：宠物绝大多数时候贴在视口右下角，那时「左上」的扇面朝向屏幕中心，
 * 视线不用跑出边界，也最不容易压到输入框，所以排第一。「正左」虽然也常用，
 * 但它会和固定在宠物左侧的面板抢位置，所以压到最后，只在其它方向都放不下时才用。
 */
export const ARC_PRESETS = [
    { key: 'tl', name: '左上', centerDeg: 135 },
    { key: 't', name: '正上', centerDeg: 90 },
    { key: 'tr', name: '右上', centerDeg: 45 },
    { key: 'b', name: '正下', centerDeg: -90 },
    { key: 'l', name: '正左', centerDeg: 180 }
];

/**
 * 默认跨度（度）。4 个按钮扫 66°，相邻约 22°。
 *
 * 这个值跟弧半径是绑在一起看的：半径 256 时相邻间距约 98px，跟按钮 34px 的
 * 直径比大概是 3:1，扇面看着开而不散。半径小的时候 72° 也不难看，
 * 但默认值只需要对默认尺寸负责。
 */
export const DEFAULT_SPAN_DEG = 66;

/**
 * 越界评估时的安全边距（px）。
 *
 * 一个按钮的「占位」不只是它自己的直径，还包括外侧那行文字标签的宽度。
 * 所以这里取一个比按钮半径大得多的值：17（按钮半径）+ 34（标签半宽）+ 余量。
 */
const SAFE_MARGIN = 60;

const DEG = Math.PI / 180;

/**
 * 把「角度 + 半径」换算成 CSS 位移。
 *
 * @param {number} deg    数学角（度）
 * @param {number} radius 半径（px）
 * @returns {{x: number, y: number}} 屏幕坐标系下的位移
 */
export function degToOffset(deg, radius)
{
    const rad = deg * DEG;

    return {
        x: radius * Math.cos(rad),
        y: -radius * Math.sin(rad)
    };
}

/**
 * 生成一弧上等分的若干槽位。
 *
 * 角度从 `centerDeg - spanDeg / 2` 排到 `centerDeg + spanDeg / 2`，
 * 端点**不**落在弧的极值上都要均分 —— 也就是说 n 个按钮时分母是 n-1，
 * 只有 1 个按钮时才退化为居中。
 *
 * @param {object} opts
 * @param {number} opts.count          按钮数量（>= 1）
 * @param {number} opts.centerDeg      弧的中心角
 * @param {number} [opts.spanDeg=72]   弧的总跨度
 * @param {number} opts.radius         半径（px）
 * @returns {Array<{deg: number, x: number, y: number, index: number}>}
 */
export function arcSlots({ count, centerDeg, spanDeg = DEFAULT_SPAN_DEG, radius })
{
    const n = Math.max(1, Math.floor(Number(count) || 0));
    const span = Number.isFinite(spanDeg) ? spanDeg : DEFAULT_SPAN_DEG;

    // 只有一枚时，起点要直接取中心角。
    // 否则 start = centerDeg - span/2，唯一那枚会落在弧的一端而不是正对着中心 ——
    // 扇面看起来是歪的，而且改配置时才会暴露。
    const start = n === 1 ? centerDeg : centerDeg - span / 2;
    const step = n === 1 ? 0 : span / (n - 1);

    const out = [];

    for (let i = 0; i < n; i += 1)
    {
        const deg = start + step * i;
        const { x, y } = degToOffset(deg, radius);

        out.push({ deg, x, y, index: i });
    }

    return out;
}

/**
 * 算一条弧在当前视口里「最远探出多少」。
 *
 * 做法是在弧上采样一批点，逐个换算成**视口绝对坐标**，
 * 再取四个方向上超出边界的最大距离。返回 0 表示完全放得下。
 *
 * @param {object} opts
 * @param {{left: number, top: number, width: number, height: number}} opts.rect 宠物的位置
 * @param {number} opts.centerDeg  待评估的中心角
 * @param {number} opts.spanDeg    跨度
 * @param {number} opts.radius     半径
 * @param {number} opts.vw         视口宽
 * @param {number} opts.vh         视口高
 * @returns {number} 越界量（px，>= 0）
 */
export function arcOverflow({ rect, centerDeg, spanDeg, radius, vw, vh })
{
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // 圆心本身加上半径就出界的话，任何角度都救不了；先记下这部分
    let worst = 0;
    const samples = 16;

    for (let s = 0; s <= samples; s += 1)
    {
        const deg = centerDeg - spanDeg / 2 + (spanDeg * s) / samples;
        const { x, y } = degToOffset(deg, radius);

        const px = cx + x;
        const py = cy + y;

        worst = Math.max(
            worst,
            SAFE_MARGIN - px,          // 探出左边
            SAFE_MARGIN - py,          // 探出上边
            px + SAFE_MARGIN - vw,     // 探出右边
            py + SAFE_MARGIN - vh      // 探出下边
        );
    }

    return Math.max(0, worst);
}

/**
 * 根据宠物当前位置，挑一个最不容易出界的弧线朝向。
 *
 * 优先级是这样来的：宠物绝大多数时候贴在右下角，那时「左上」最好看 ——
 * 扇面朝向屏幕中央，视线不用跑出边界。所以预设表里 tl 排第一，
 * 只有在它明显放不下时才退而求其次。
 *
 * @param {object} opts
 * @param {{left: number, top: number, width: number, height: number}} opts.rect
 * @param {number} [opts.spanDeg=72]
 * @param {number} opts.radius
 * @param {number} opts.vw
 * @param {number} opts.vh
 * @returns {{key: string, name: string, centerDeg: number, overflow: number}}
 */
export function pickArcCenter({ rect, spanDeg = DEFAULT_SPAN_DEG, radius, vw, vh })
{
    let best = null;

    for (const preset of ARC_PRESETS)
    {
        const overflow = arcOverflow({
            rect,
            centerDeg: preset.centerDeg,
            spanDeg,
            radius,
            vw,
            vh
        });

        // 严格小于：同分时保留靠前的预设，保证行为可预测
        if (!best || overflow < best.overflow - 0.5)
        {
            best = { key: preset.key, name: preset.name, centerDeg: preset.centerDeg, overflow };
        }
    }

    return best;
}

/**
 * 人物素材的实际可见外缘：离画面中心最远的不透明像素，占边长的比例。
 *
 * 实测自 assets/anim 全部 50 段 VP9+alpha 素材（Chromium 逐帧画到 canvas
 * 读 alpha，每段采 14 帧）：中位 0.421，p90 0.504，max 0.580（睡觉第二段）。
 *
 * 弧半径锚定取 **max** —— 任何一段动画、任何一帧，按钮都不会压到人物。
 * 更早的版本锚的是「方框的角」（0.707）再加主按钮时代的 84px 余量，
 * 主按钮移除后那部分余量就没有了存在理由。
 */
export const PET_EXTENT = 0.58;

/**
 * 人物外缘到弧的间距 = 按钮自身半径 17 + 视觉余量 12。
 *
 * 12px 是对「最坏那一帧」的净空间；典型姿态（外缘 0.42）下会自然拉大到
 * 40px 以上。再小按钮就可能蹭到动作幅度大的动画，再大就回到「飘在半空」。
 */
export const ORB_GAP = 29;

/**
 * 算弧半径。
 *
 * 公式是 `size × PET_EXTENT + ORB_GAP`：
 *
 *     size × PET_EXTENT   —— 从中心走到人物素材的**实际可见外缘**（实测值）
 *     +  ORB_GAP          —— 让出按钮自身半径和一圈呼吸空间
 *
 *   size 260 → 180px（旧公式 268：方框角 184 + 主按钮半径 18 + 两排间距 66）
 *   size 360 → 238px
 *   size 100 → 92px（下限）
 *   size 600 → 377px
 *
 * 上下限只在极端尺寸上兜底：下限保证小宠物的按钮之间不会太挤，
 * 上限防止宠物尺寸被配得离谱。
 *
 * 注意这**不是最终值** —— 浏览器侧还会按视口短边再收缩一次
 * （见 lib/client.js 的 layoutFor）。
 *
 * @param {number} size       宠物边长（px）
 * @param {number} [override] 显式指定时直接用它（> 0 才生效）
 * @returns {number}
 */
export function orbRadius(size, override)
{
    const explicit = Number(override);

    if (Number.isFinite(explicit) && explicit > 0)
    {
        return explicit;
    }

    const s = Number(size);
    const base = (Number.isFinite(s) && s > 0 ? s : 260) * PET_EXTENT + ORB_GAP;

    return Math.round(Math.min(420, Math.max(96, base)));
}

/**
 * 气泡面板的默认宽度 / 最小宽度 / 离视口边缘的留白（px）。
 *
 * 272 是读数最舒服的宽度（一行放得下「降水概率 30%」这种最长的一行）；
 * 收窄到 188 仍不至于让数值换行，再窄就该换一种呈现方式了。
 */
export const PANEL_W = 272;
export const PANEL_MIN_W = 188;
export const PANEL_EDGE = 12;

// 气泡尾巴的长度（px）：从面板内缘伸出、指向她的那一段。
export const PANEL_TAIL = 24;
export const PANEL_TAIL_MIN = 10;

/**
 * 尾巴所在那一带（舞台最底下 26px），人物外缘离舞台框边缘的**最近**实测值
 * （px，尺寸 260 下）。
 *
 * 实测口径：50 段素材各取 12 帧，逐帧读 alpha > 16 的像素，按 10 段行高统计
 * 横向外缘。尾巴改成「气泡右下角」之后，它落在最底下那一带（y = 234~260）：
 * 结果 p05 = 71 / p50 = 107 / 最坏 = 53。
 *
 * 比躯干那一行（最坏 39）宽裕得多 —— 也就是说尾巴挪到右下角之后，即使面板
 * 被窄视口往里挤，尾巴尖也不会戳到她身上。
 */
export const PET_TAIL_ROW_EDGE = 53;

// 收缩后的弧半径下限：再小就贴到模型上了。
export const MIN_FIT_R = 120;

/**
 * 按视口收缩时，弧半径最多占视口短边的比例。
 *
 * 40% 是个经验值：一条弧要占掉 ±半径 的范围，再加上外侧的文字标签，
 * 取 40% 时短边还留得下约 20% 的余量给面板和宿主界面。
 */
export const FIT_RATIO = 0.40;

/**
 * 把理想半径收缩到当前视口放得下的尺寸。
 *
 * 为什么必须收缩：宠物 260px 时弧半径是 268px，加上外侧标签要占掉约
 * 610px 见方的范围。DSH 的侧边面板常常只有 400~500px 宽，硬撑的话
 * 扇面会整片顶到屏幕外 —— 而那个尺寸下再怎么挑朝向都救不回来。
 *
 * 收缩的代价是主按钮会靠近、甚至压到模型上。模型是透明背景的，人物实际
 * 占位比方形区域小一圈，所以视觉上还能看；反过来若为了保住「主按钮在模型外」
 * 而不收缩，按钮就直接跑到屏幕外面去了。
 *
 * @param {number} wanted 理想半径
 * @param {{w: number, h: number}} viewport 视口尺寸
 * @returns {number}
 */
export function fitRadius(wanted, viewport)
{
    const vw = Number(viewport && viewport.w);
    const vh = Number(viewport && viewport.h);
    const short = Math.min(Number.isFinite(vw) && vw > 0 ? vw : 1024, Number.isFinite(vh) && vh > 0 ? vh : 768);

    const fit = Math.max(MIN_FIT_R, short * FIT_RATIO);
    const r = Number(wanted);

    return Math.round(Math.min(Number.isFinite(r) && r > 0 ? r : MIN_FIT_R, fit));
}

/**
 * 相邻两枚按钮的默认角距（度）。
 *
 * 24° 是现有「4 枚按钮扫 72°」反推出来的值（72 / (4-1)）。按钮数量变化时
 * 保持这个角距不变，扇面的疏密手感就跟按钮数无关 —— 加按钮只是扇子张得
 * 更开，不会越加越挤。
 */
export const DEFAULT_STEP_DEG = 24;

/**
 * 按按钮数量算弧线的跨度。
 *
 * 设计规则：角距恒定（stepDeg），跨度随数量线性增长，但被 maxSpanDeg 封顶。
 * 封顶之后由 arcSlots 的「端点均分」自然压缩角距 —— 任何数量下按钮仍然
 * 严格均分，只是更密一点。
 *
 *   count=1 → 0°（arcSlots 对单枚有居中特判，跨度是多少都无所谓）
 *   count=4 → 72°（与旧行为完全一致）
 *   count=5 → 96°（若 maxSpanDeg=96）
 *
 * @param {object} opts
 * @param {number} opts.count                        按钮数量
 * @param {number} [opts.stepDeg=DEFAULT_STEP_DEG]   期望角距
 * @param {number} [opts.maxSpanDeg=96]              跨度上限
 * @returns {number} 跨度（度，>= 0）
 */
export function spanForCount({ count, stepDeg = DEFAULT_STEP_DEG, maxSpanDeg = 96 })
{
    const n = Math.max(1, Math.floor(Number(count) || 0));
    const step = Number.isFinite(Number(stepDeg)) && Number(stepDeg) > 0 ? Number(stepDeg) : DEFAULT_STEP_DEG;
    const cap = Number.isFinite(Number(maxSpanDeg)) && Number(maxSpanDeg) > 0 ? Number(maxSpanDeg) : 96;

    return Math.min((n - 1) * step, cap);
}

/**
 * 弧上一页最多放几枚槽位（含「更多」按钮本身）。
 *
 * 5 枚是密度与越界风险的平衡点：按 24° 角距要扫 96°，再宽扇面就散；
 * 而 5 枚以内还不需要「更多」按钮占位，直接全展示。
 */
export const DEFAULT_PAGE_SIZE = 5;

/**
 * 把「功能按钮总数」切成弧上的一页。
 *
 * 分页规则（渐进式展示）：
 *
 *   - total <= pageSize：一页放完，没有「更多」按钮
 *   - total >  pageSize：每页放 pageSize-1 枚真按钮 + 末尾 1 枚「更多」；
 *     点「更多」翻到下一页，末页再点回到首页（循环）
 *
 * 返回的 start/end 是**真按钮数组**的切片区间（不含「更多」），
 * 调用方切完片再视 hasMore 追加合成按钮即可。
 *
 * @param {object} opts
 * @param {number} opts.total                        真按钮总数
 * @param {number} opts.page                         目标页码（任意整数，内部取模归一）
 * @param {number} [opts.pageSize=DEFAULT_PAGE_SIZE] 弧上槽位上限（含「更多」）
 * @returns {{pageCount: number, page: number, start: number, end: number, hasMore: boolean}}
 */
export function sliceArcPage({ total, page, pageSize = DEFAULT_PAGE_SIZE })
{
    const n = Math.max(0, Math.floor(Number(total) || 0));
    const size = Math.max(2, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE));

    if (n <= size)
    {
        return { pageCount: 1, page: 0, start: 0, end: n, hasMore: false };
    }

    // 有「更多」占位时，每页只能放 size-1 枚真按钮
    const per = size - 1;
    const pageCount = Math.ceil(n / per);
    const p = ((Math.floor(Number(page) || 0) % pageCount) + pageCount) % pageCount;
    const start = p * per;

    return { pageCount, page: p, start, end: Math.min(n, start + per), hasMore: true };
}

/**
 * 算每个按钮的错位延迟。
 *
 * 关键点：**进出方向必须相反**。
 *
 *  - 入场：从弧的一端依次亮起来（index 递增），像扇子抖开
 *  - 退场：反向（index 大的先收），像扇子合上
 *
 * 两个方向都用同一个顺序会显得机械 —— 收的时候最后出现的那个最先消失，
 * 才是物理直觉。这条是动效设计里反复被提到的点，代价只是一次数组反转。
 *
 * @param {object} opts
 * @param {number} opts.count
 * @param {number} opts.staggerMs 相邻两项的间隔
 * @param {'in'|'out'} opts.dir
 * @returns {number[]} 每项的延迟（ms）
 */
export function staggerDelays({ count, staggerMs, dir })
{
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const step = Math.max(0, Number(staggerMs) || 0);

    const out = [];

    for (let i = 0; i < n; i += 1)
    {
        out.push((dir === 'out' ? n - 1 - i : i) * step);
    }

    return out;
}

/**
 * 整套动画的总时长 —— 用来给测试和「自动收起」的计时器做基准。
 *
 * @param {object} opts
 * @param {number} opts.count
 * @param {number} opts.staggerMs
 * @param {number} opts.durationMs 单个按钮的动画时长
 * @returns {number}
 */
export function totalDuration({ count, staggerMs, durationMs })
{
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const step = Math.max(0, Number(staggerMs) || 0);

    return Math.max(0, n - 1) * step + Math.max(0, Number(durationMs) || 0);
}

/**
 * 气泡面板的落位。
 *
 * ## 为什么需要它
 *
 * 面板不是浮在角落的系统窗口，是「她说的一段更完整的话」—— 既然是气泡，
 * 尾巴就必须指得着人。原来的面板停在舞台框外 24px，而实测（50 段素材 ×
 * 12 帧，逐帧读 alpha）她在尾巴那一带的横向外缘只到舞台框内 39~107px：
 * 尾巴尖离她 50~73px，中间是一整片空气 —— 尾巴指向了虚空。
 *
 * ## 怎么定
 *
 * 面板内缘直接锚到舞台框边缘（pull = 0），24px 的尾巴横跨剩下的距离；
 * 39px 的实测最坏体型仍留有余量。只有当视口这一侧真的放不下时才往里让，
 * 并且**同步缩短尾巴**：越靠里尾巴越短，尾巴尖始终停在她外缘之外。
 * 宽度同理 —— 先收窄、再贴边，最后才考虑换边（换边尾巴要改朝另一只手，
 * 能不换就不换）。
 *
 * ## 参数约定
 *
 *   side  +1 = 面板在舞台左侧、尾巴朝右      -1 = 镜像
 *   pull      面板内缘越过舞台框、朝人物方向让出的距离（px，>= 0）
 *
 * @param {object} opts
 * @param {{left:number,right:number,width:number}} opts.rect 舞台框在屏幕上的位置
 * @param {{w:number,h:number}} opts.viewport                 视口尺寸
 * @param {number} [opts.side=1]          配置里期望的一侧
 * @param {number} [opts.wantW=PANEL_W]   理想宽度
 * @param {number} [opts.minW=PANEL_MIN_W] 可接受的最小宽度
 * @param {number} [opts.edge=PANEL_EDGE] 面板离视口边缘的最小留白
 * @returns {{side:number,width:number,pull:number,tail:number}}
 */
export function panelPlacement({ rect, viewport, side = 1, wantW = PANEL_W, minW = PANEL_MIN_W, edge = PANEL_EDGE })
{
    const vw = Number(viewport && viewport.w);
    const screenW = Number.isFinite(vw) && vw > 0 ? vw : 1024;

    const boxW = Number(rect && rect.width) || 0;
    const left = Number(rect && rect.left) || 0;
    const rightEdge = rect && rect.right != null ? Number(rect.right) : left + boxW;
    const right = Number.isFinite(rightEdge) && rightEdge > 0 ? rightEdge : left + boxW;

    const roomOf = (s) => (s > 0 ? Math.max(0, left) : Math.max(0, screenW - right));

    const want = side === -1 ? -1 : 1;
    const pick = (roomOf(want) >= minW + edge || roomOf(-want) <= roomOf(want)) ? want : -want;

    const room = roomOf(pick);
    const w = Number.isFinite(Number(wantW)) && Number(wantW) > 0 ? Number(wantW) : PANEL_W;
    const min = Number.isFinite(Number(minW)) && Number(minW) > 0 ? Number(minW) : PANEL_MIN_W;
    const pad = Number.isFinite(Number(edge)) && Number(edge) >= 0 ? Number(edge) : PANEL_EDGE;

    const width = Math.round(Math.min(w, Math.max(min, room - pad)));
    const pull = Math.max(0, Math.round(width + pad - room));
    const tail = Math.round(Math.max(PANEL_TAIL_MIN, Math.min(PANEL_TAIL, PET_TAIL_ROW_EDGE - pull - 4)));

    return { side: pick, width, pull, tail };
}

export default {
    ARC_PRESETS,
    DEFAULT_SPAN_DEG,
    DEFAULT_STEP_DEG,
    DEFAULT_PAGE_SIZE,
    PET_EXTENT,
    ORB_GAP,
    MIN_FIT_R,
    FIT_RATIO,
    fitRadius,
    degToOffset,
    arcSlots,
    arcOverflow,
    pickArcCenter,
    orbRadius,
    spanForCount,
    sliceArcPage,
    staggerDelays,
    totalDuration,
    PANEL_W,
    PANEL_MIN_W,
    PANEL_EDGE,
    PANEL_TAIL,
    PANEL_TAIL_MIN,
    PET_TAIL_ROW_EDGE,
    panelPlacement
};
