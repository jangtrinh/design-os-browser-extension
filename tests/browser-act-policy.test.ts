import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateActPolicy, isAllowedUrl, type ActTarget } from '../extension/src/core/act-policy.js';

// ---- Engine harness: fake tab + content script; no browser, no network. ----
const harness = vi.hoisted(() => ({
  tabUrl: 'https://www.linkedin.com/feed/',
  target: { role: 'link', name: 'Jang Trinh', tag: 'a', href: 'https://www.linkedin.com/in/jangtrinh/' } as Record<string, unknown>,
  dispatched: [] as string[],
}));

vi.mock('../extension/src/background/tab-router.js', () => ({
  resolveTargetTab: async () => ({ id: 7, url: harness.tabUrl }),
  navigateAndWait: async () => {},
}));

vi.mock('../extension/src/core/webext-polyfill.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../extension/src/core/webext-polyfill.js')>();
  return {
    ...real,
    getSessionStore: () => real.createMemoryKeyValueStore(),
    getLocalStore: () => real.createMemoryKeyValueStore(),
    sendTabMessage: async (_tabId: number, msg: { op: string }) => {
      if (msg.op === 'describe_ref') return { ok: true, outcome: 'COMMITTED', data: harness.target };
      harness.dispatched.push(msg.op);
      return { ok: true, outcome: 'COMMITTED', data: { done: msg.op } };
    },
  };
});

const { ExtensionEngine } = await import('../extension/src/background/engine.js');
const { createMemoryKeyValueStore } = await import('../extension/src/core/webext-polyfill.js');

function newEngine() {
  return new ExtensionEngine({
    capabilities: { tier: 'tier1-chromium' } as never,
    sessionStore: createMemoryKeyValueStore(),
    localStore: createMemoryKeyValueStore(),
  });
}

const act = (params: Record<string, unknown>) => ({ id: 'a1', action: 'browser.act', params: { op: 'click_ref', ref: 3, ...params } });

describe('act policy (pure)', () => {
  const page = 'https://www.linkedin.com/feed/';
  const t = (role: string, name: string, extra: Partial<ActTarget> = {}): ActTarget => ({ role, name, tag: role === 'link' ? 'a' : 'button', ...extra });

  it('allows read-only clicks: navigation links, show more, pagination, tabs', () => {
    for (const target of [
      t('link', 'Jang Trinh', { href: 'https://www.linkedin.com/in/jangtrinh/' }),
      t('button', 'Show more'),
      t('button', 'Load more comments'),
      t('button', 'Next'),
      t('button', 'Page 2'),
      t('tab', 'Posts'),
    ]) {
      expect(evaluateActPolicy({ op: 'click_ref', target, pageUrl: page })).toMatchObject({ allowed: true, cls: 'read' });
    }
  });

  it('blocks writes without a human: send, like, comment, connect, message, post, typing, form submit, unknown buttons', () => {
    for (const [op, target] of [
      ['click_ref', t('button', 'Send')],
      ['click_ref', t('link', 'Send', { href: 'https://www.linkedin.com/feed/update/urn:li:share:1/' })],
      ['click_ref', t('button', 'Reaction button state: Like')],
      ['click_ref', t('button', 'Comment')],
      ['click_ref', t('button', 'Connect')],
      ['click_ref', t('link', 'Message', { href: 'https://www.linkedin.com/messaging/compose/?x=1' })],
      ['click_ref', t('button', 'Start a post')],
      ['click_ref', t('button', 'Go', { inForm: true })],
      ['click_ref', t('button', 'Mystery control')],
      ['fill_ref', t('textbox', 'Text editor for creating comment')],
    ] as const) {
      const d = evaluateActPolicy({ op, target, pageUrl: page });
      expect(d.allowed, `${op} ${target.name}`).toBe(false);
      expect(d).toMatchObject({ code: 'ACT_REQUIRES_HUMAN_APPROVAL', needsHuman: true });
    }
  });

  it('rejects disallowed domains, off-allowlist links and unknown ops outright', () => {
    expect(evaluateActPolicy({ op: 'click_ref', target: t('button', 'Show more'), pageUrl: 'https://evil.example/' })).toMatchObject({ allowed: false, code: 'ACT_DOMAIN_NOT_ALLOWED', needsHuman: false });
    expect(evaluateActPolicy({ op: 'click_ref', target: t('link', 'Read more', { href: 'https://evil.example/x' }), pageUrl: page })).toMatchObject({ allowed: false, code: 'ACT_DOMAIN_NOT_ALLOWED' });
    expect(evaluateActPolicy({ op: 'eval_js', target: t('button', 'Next'), pageUrl: page })).toMatchObject({ allowed: false, code: 'ACT_OP_NOT_ALLOWED' });
    expect(isAllowedUrl('http://www.linkedin.com/feed/')).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('browser.act through the engine', () => {
  beforeEach(() => {
    harness.tabUrl = 'https://www.linkedin.com/feed/';
    harness.dispatched.length = 0;
  });

  it('read allowed: a navigation click is dispatched', async () => {
    harness.target = { role: 'link', name: 'Jang Trinh', tag: 'a', href: 'https://www.linkedin.com/in/jangtrinh/' };
    const res = await newEngine().handleRpc(act({}), 'agent-rpc');
    expect(res).toMatchObject({ ok: true, outcome: 'COMMITTED' });
    expect(harness.dispatched).toEqual(['click_ref']);
  });

  it('write blocked without the human gate; agent cannot self-approve; popup approval works once', async () => {
    harness.target = { role: 'button', name: 'Send', tag: 'button' };
    const engine = newEngine();

    const first = await engine.handleRpc(act({}), 'agent-rpc');
    expect(first).toMatchObject({ ok: false, outcome: 'BLOCKED', humanGate: 'BLOCKED_POLICY' });
    expect(first.error?.code).toBe('ACT_REQUIRES_HUMAN_APPROVAL');
    const approvalId = (first.data as { approvalId: string }).approvalId;
    expect(harness.dispatched).toEqual([]);

    const selfApprove = await engine.handleRpc({ id: 'd1', action: 'browser.act.decide', params: { approvalId, decision: 'approved' } }, 'agent-rpc');
    expect(selfApprove.ok).toBe(false);
    expect((await engine.handleRpc(act({ approvalId }), 'agent-rpc')).ok).toBe(false);
    expect(harness.dispatched).toEqual([]);

    const human = await engine.handleRpc({ id: 'd2', action: 'browser.act.decide', params: { approvalId, decision: 'approved' } }, 'extension-popup');
    expect(human.ok).toBe(true);
    const approved = await engine.handleRpc(act({ approvalId }), 'agent-rpc');
    expect(approved).toMatchObject({ ok: true, outcome: 'COMMITTED' });
    expect(harness.dispatched).toEqual(['click_ref']);

    const reused = await engine.handleRpc(act({ approvalId }), 'agent-rpc');
    expect(reused.ok).toBe(false);
    expect(harness.dispatched).toEqual(['click_ref']);
  });

  it('an approval for one ref does not cover another ref or different typed text', async () => {
    harness.target = { role: 'textbox', name: 'Text editor for creating comment', tag: 'div', editable: true };
    const engine = newEngine();
    const first = await engine.handleRpc(act({ op: 'fill_ref', value: 'hello' }), 'agent-rpc');
    const approvalId = (first.data as { approvalId: string }).approvalId;
    await engine.handleRpc({ id: 'd', action: 'browser.act.decide', params: { approvalId, decision: 'approved' } }, 'extension-popup');
    expect((await engine.handleRpc(act({ op: 'fill_ref', value: 'HELLO', approvalId }), 'agent-rpc')).ok).toBe(false);
    expect((await engine.handleRpc(act({ op: 'fill_ref', value: 'hello', ref: 4, approvalId }), 'agent-rpc')).ok).toBe(false);
    expect((await engine.handleRpc(act({ op: 'fill_ref', value: 'hello', approvalId }), 'agent-rpc')).ok).toBe(true);
    expect(harness.dispatched).toEqual(['fill_ref']);
  });

  it('disallowed domain rejected, and --url navigation off the allowlist is refused', async () => {
    harness.tabUrl = 'https://evil.example/page';
    harness.target = { role: 'button', name: 'Show more', tag: 'button' };
    const res = await newEngine().handleRpc(act({}), 'agent-rpc');
    expect(res.error?.code).toBe('ACT_DOMAIN_NOT_ALLOWED');
    expect(harness.dispatched).toEqual([]);

    harness.tabUrl = 'https://www.linkedin.com/feed/';
    const nav = await newEngine().handleRpc({ id: 'o', action: 'browser.observe', params: { url: 'https://evil.example/' } }, 'agent-rpc');
    expect(nav.error?.code).toBe('NAVIGATION_DOMAIN_NOT_ALLOWED');
  });

  it('unknown op is rejected before anything is described or dispatched', async () => {
    const res = await newEngine().handleRpc(act({ op: 'submit_form' }), 'agent-rpc');
    expect(res.error?.code).toBe('ACT_OP_NOT_ALLOWED');
    expect(harness.dispatched).toEqual([]);
  });
});
