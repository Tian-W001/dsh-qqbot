/**
 * no-reply 协议测试
 *
 * 协议要稳：既不能漏掉标识符（该沉默时说话了），
 * 也不能误伤正文（把有用内容吞掉）。
 */
import { describe, it, expect } from 'vitest';
import { resolveNoReply, buildNoReplyInstruction } from './no-reply.ts';

const MARKER = 'no-response';

describe('resolveNoReply', () => {
  it('整段就是标识符 → 丢弃', () => {
    const r = resolveNoReply('no-response', MARKER);
    expect(r.matched).toBe(true);
    expect(r.suppress).toBe(true);
  });

  it('容忍首尾空白与换行', () => {
    expect(resolveNoReply('\n  no-response  \n', MARKER).suppress).toBe(true);
  });

  it('容忍反引号包裹（模型爱加 Markdown）', () => {
    expect(resolveNoReply('`no-response`', MARKER).suppress).toBe(true);
    expect(resolveNoReply('**no-response**', MARKER).suppress).toBe(true);
  });

  it('容忍句末标点', () => {
    expect(resolveNoReply('no-response。', MARKER).suppress).toBe(true);
    expect(resolveNoReply('no-response.', MARKER).suppress).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(resolveNoReply('NO-RESPONSE', MARKER).suppress).toBe(true);
  });

  it('标识符单独成行 + 正文 → 剥掉标识符，保留正文', () => {
    const r = resolveNoReply('no-response\n\n这是真正要说的内容', MARKER);

    expect(r.matched).toBe(true);
    expect(r.suppress).toBe(false);
    expect(r.text).toBe('这是真正要说的内容');
  });

  it('正文在前、标识符在后 → 同样只剥标识符', () => {
    const r = resolveNoReply('这是要说的内容\nno-response', MARKER);

    expect(r.suppress).toBe(false);
    expect(r.text).toBe('这是要说的内容');
  });

  it('正文里顺带提到标识符 → 原样发送，不误伤', () => {
    const raw = '我不会输出 no-response 这种东西';
    const r = resolveNoReply(raw, MARKER);

    expect(r.matched).toBe(false);
    expect(r.text).toBe(raw);
  });

  it('普通回复完全不受影响', () => {
    const raw = '这个报错是因为端口被占用了';
    const r = resolveNoReply(raw, MARKER);

    expect(r.matched).toBe(false);
    expect(r.suppress).toBe(false);
    expect(r.text).toBe(raw);
  });

  it('空文本不触发', () => {
    expect(resolveNoReply('', MARKER).suppress).toBe(false);
    expect(resolveNoReply('   ', MARKER).suppress).toBe(false);
  });

  it('标识符配置为空时不触发（防止把一切内容都吞掉）', () => {
    const r = resolveNoReply('任意内容', '');

    expect(r.matched).toBe(false);
    expect(r.suppress).toBe(false);
    expect(r.text).toBe('任意内容');
  });

  it('支持自定义标识符', () => {
    expect(resolveNoReply('<<SILENT>>', '<<SILENT>>').suppress).toBe(true);
    expect(resolveNoReply('no-response', '<<SILENT>>').suppress).toBe(false);
  });
});

describe('buildNoReplyInstruction', () => {
  it('提示词里原样包含标识符（保证与出站识别同源）', () => {
    const text = buildNoReplyInstruction(MARKER);

    expect(text).toContain(MARKER);
    expect(text).toContain('发言判断');
  });

  it('明确要求「该说话时必须说」，避免模型滥用', () => {
    const text = buildNoReplyInstruction(MARKER);

    expect(text).toContain('叫你的名字');
    expect(text).toContain('不要为了省事而滥用');
  });

  it('换标识符时提示词跟着变', () => {
    expect(buildNoReplyInstruction('SILENT')).toContain('SILENT');
    expect(buildNoReplyInstruction('SILENT')).not.toContain('no-response');
  });
});
