/**
 * 出站「模型自决不回复」拦截测试
 *
 * 走真实的 createOutboundHandler，端到端验证：
 * 模型输出标识符 → 群里一条消息都不发；正常文本 → 照发。
 *
 * 注意：这里只发 `assistant/message`，不发 `assistant/chunk`。
 * 因为当前 dsh 的 chunk 走瞬时事件 `agent/assistant-stream`，而插件只订阅
 * `session/event`（持久流只带 assistant/message）—— chunk 路径在本插件里不会被触发。
 */
import { describe, it, expect, vi } from 'vitest';
import { createOutboundHandler } from './outbound.ts';
import type { SessionManager, SessionRecord } from '../session/index.ts';
import type { QQBotSender } from './outbound-buffer.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeConfig(overrides: Partial<ImQQBotConfig['noReply']> = {}): ImQQBotConfig {
  return {
    streaming: false,
    textChunkLimit: 4500,
    showToolResults: false,
    noReply: { enabled: true, marker: 'no-response', scope: 'group', ...overrides },
  } as unknown as ImQQBotConfig;
}

function makeRecord(target: ReplyTarget): SessionRecord {
  return {
    sessionId: 's1',
    key: 'k',
    replyTarget: target,
    agent: {},
    createdAt: 0,
    lastActiveAt: 0,
  } as unknown as SessionRecord;
}

function makeBot() {
  return {
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    openStream: vi.fn(),
  } as unknown as QQBotSender & { sendMarkdown: ReturnType<typeof vi.fn> };
}

const groupTarget: ReplyTarget = { scope: 'group', targetId: 'g1', msgId: 'm1' };
const c2cTarget: ReplyTarget = { scope: 'c2c', targetId: 'u1', msgId: 'm1' };

/** 跑一个完整轮次：assistant/message → turn/end，返回实际发出去的文本 */
async function runTurn(
  handler: ReturnType<typeof createOutboundHandler>,
  bot: ReturnType<typeof makeBot>,
  text: string,
) {
  const session = { header: { id: 's1' } };
  handler(session, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  });
  handler(session, { type: 'turn/end', data: { reason: { kind: 'stop' } } });
  await new Promise((r) => setTimeout(r, 10));
  return bot.sendMarkdown.mock.calls.map((c) => c[1]).join('');
}

function setup(target: ReplyTarget, config: ImQQBotConfig) {
  const bot = makeBot();
  const record = makeRecord(target);
  const manager = { findBySessionId: () => record } as unknown as SessionManager;
  return { handler: createOutboundHandler(manager, bot, config, logger), bot };
}

describe('出站 no-reply 拦截', () => {
  it('群聊：模型只输出标识符 → 一条消息都不发', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig());

    expect(await runTurn(handler, bot, 'no-response')).toBe('');
  });

  it('群聊：正常文本照常发送', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig());

    expect(await runTurn(handler, bot, '这个报错是端口被占用了')).toContain('端口被占用');
  });

  it('群聊：标识符 + 正文 → 只发正文，不带标识符', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig());

    const sent = await runTurn(handler, bot, 'no-response\n\n顺便说一句，端口被占了');

    expect(sent).toContain('端口被占了');
    expect(sent).not.toContain('no-response');
  });

  it('群聊：反引号包裹、带句末标点、大小写不同都能识别', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig());

    expect(await runTurn(handler, bot, '`no-response`')).toBe('');
    expect(await runTurn(handler, bot, 'no-response。')).toBe('');
    expect(await runTurn(handler, bot, 'NO-RESPONSE')).toBe('');
  });

  it('群聊：正文里顺带提到标识符 → 不误伤，原样发送', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig());

    expect(await runTurn(handler, bot, '我不会输出 no-response 这种东西')).toContain('我不会输出');
  });

  it('关闭开关时不做任何拦截', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig({ enabled: false }));

    expect(await runTurn(handler, bot, 'no-response')).toContain('no-response');
  });

  it('默认 scope=group：私聊不拦截（避免在私聊里装死）', async () => {
    const { handler, bot } = setup(c2cTarget, makeConfig());

    expect(await runTurn(handler, bot, 'no-response')).toContain('no-response');
  });

  it('scope=all：私聊同样拦截', async () => {
    const { handler, bot } = setup(c2cTarget, makeConfig({ scope: 'all' }));

    expect(await runTurn(handler, bot, 'no-response')).toBe('');
  });

  it('自定义标识符生效，且不影响原标识符', async () => {
    const { handler, bot } = setup(groupTarget, makeConfig({ marker: '<<SILENT>>' }));

    expect(await runTurn(handler, bot, '<<SILENT>>')).toBe('');
    expect(await runTurn(handler, bot, 'no-response')).toContain('no-response');
  });
});
