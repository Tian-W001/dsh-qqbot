/**
 * 「模型自决不回复」协议
 *
 * ── 思路 ──
 * 不引入额外的判定模型，也不加中间件。而是：
 *   1. 在系统提示词里告诉模型一个**标识符**（默认 `no-response`）；
 *   2. 模型判断「这条不该我插话」时，只输出这个标识符；
 *   3. 出站层识别到它 → **不发送任何消息**。
 *
 * 为什么让主模型判断，而不是另起一个小模型：
 *   - 主模型掌握完整上下文（人设、工具、历史），判断质量更高
 *   - 少一次模型调用，也少一份要单独维护的判定提示词
 *   - 不引入中间件，没有链上顺序耦合
 * 代价：主 agent 依然跑完这一轮，省的是「不说废话」，不是 token。
 *
 * 本文件是纯函数，供 session（注入提示词）与 transport（出站拦截）共用，
 * 保证「提示词里的标识符」与「代码里识别的标识符」永远同源。
 */

/** 宽松归一化：去掉空白与常见 Markdown 包装字符 */
function normalizeStrict(text: string): string {
  return text.replace(/[\s`*_~"'「」【】]/g, '').toLowerCase();
}

/** 更宽松的归一化：额外容忍模型加的句末标点 */
function normalizeLoose(text: string): string {
  return normalizeStrict(text).replace(/[.,。!！?？:：;；、]/g, '');
}

/** 出站处理的判定结果 */
export interface NoReplyOutcome {
  /** 是否检测到标识符 */
  matched: boolean;
  /** true = 模型自决不发言，不应发出任何消息 */
  suppress: boolean;
  /** 实际要发送的文本（已剥离标识符）；suppress 时为 '' */
  text: string;
}

/**
 * 从模型输出里解析「是否不回复」
 *
 * 覆盖三种真实形态：
 *   1. 整段就是标识符（含 `` `no-response` ``、`**no-response**`、`no-response。` 等包装）
 *      → suppress
 *   2. 标识符单独成行、但旁边还有正文 → 剥掉该行，**保留正文**（不吞掉有用内容）
 *   3. 正文里只是顺带提到标识符 → 不动，原样发送
 *
 * @param raw - 模型输出的原始文本
 * @param marker - 配置的标识符
 */
export function resolveNoReply(raw: string, marker: string): NoReplyOutcome {
  const target = normalizeStrict(marker);
  if (target.length === 0 || raw.length === 0) {
    return { matched: false, suppress: false, text: raw };
  }

  // 形态 2/1：逐行匹配，命中行被剥离
  const lines = raw.split('\n');
  const kept = lines.filter((line) => normalizeStrict(line) !== target);
  if (kept.length !== lines.length) {
    const rest = kept.join('\n').trim();
    return rest === ''
      ? { matched: true, suppress: true, text: '' }
      : { matched: true, suppress: false, text: rest };
  }

  // 形态 1（单行/被包裹）：整段宽松归一后等于标识符
  if (normalizeLoose(raw) === normalizeLoose(marker)) {
    return { matched: true, suppress: true, text: '' };
  }

  // 形态 3：不动
  return { matched: false, suppress: false, text: raw };
}

/**
 * 生成注入给模型的「发言判断」提示词
 *
 * 措辞刻意保持**范围中立**（不说「群里」「群友」）：
 * scope=group 时只注入群聊会话，scope=all 时私聊也会注入，
 * 同一段文字要两边都读得通。
 * 标识符由配置提供并原样嵌入，保证与出站识别逻辑一致。
 */
export function buildNoReplyInstruction(marker: string): string {
  return [
    '【发言判断】',
    '并非每条消息都需要你回应。',
    '',
    '如果这条消息没有在跟你说话、与你无关，或者你插话只会打扰别人，',
    '那就不要输出任何内容，只输出下面这个标识符（原样，单独一行）：',
    '',
    marker,
    '',
    '规则：',
    '- 有人在问你、叫你的名字/昵称、或话题与你相关时，正常回复，不要输出标识符',
    `- 输出 ${marker} 之后不会有任何消息发出，你也无需解释原因`,
    `- 除 ${marker} 外不要输出任何其他文字`,
    '- 不要为了省事而滥用它：该你说话的时候必须说',
  ].join('\n');
}
