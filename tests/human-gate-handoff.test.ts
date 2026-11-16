import { describe, expect, it } from 'vitest';
import { CopilotQueueManager } from '../extension/src/adapters/linkedin/copilot-composer.js';
import { detectHumanGate } from '../extension/src/core/human-gate-detector.js';
import { createMemoryKeyValueStore } from '../extension/src/core/webext-polyfill.js';

describe('Human Gate Handoff & Copilot Approval Queue', () => {
  it('classifies challenges, status 429/451, authwalls, and paywalls without bypass', () => {
    expect(
      detectHumanGate({ url: 'https://www.linkedin.com/checkpoint/challenge/AgH123' }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({ url: 'https://www.linkedin.com/feed/', statusCodes: [451] }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({ url: 'https://www.linkedin.com/feed/', statusCodes: [429] }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({
        url: 'https://www.linkedin.com/in/someone',
        domMarkers: ['https://iframe.arkoselabs.com/v2/enforcement'],
      }).state,
    ).toBe('BLOCKED_CHALLENGE');

    expect(
      detectHumanGate({ url: 'https://www.linkedin.com/uas/login' }).state,
    ).toBe('BLOCKED_AUTH');

    expect(
      detectHumanGate({ url: 'https://www.linkedin.com/premium/products/' }).state,
    ).toBe('BLOCKED_PAYMENT');

    expect(
      detectHumanGate({ url: 'https://www.linkedin.com/in/linh-nguyen' }).state,
    ).toBe('CLEAR');
  });

  it('prevents agent-rpc self-approval while permitting extension-popup human decisions', async () => {
    const queue = new CopilotQueueManager(createMemoryKeyValueStore());
    const staged = await queue.enqueue({
      kind: 'message',
      target: 'linh-nguyen',
      body: 'Hi Linh, following up on our WebExtension thread.',
      prefilled: true,
      callerOrigin: 'agent-rpc',
    });

    expect(staged.sent).toBe(false);
    expect(staged.status).toBe('prefilled');

    const agentAttempt = await queue.decide({
      queueId: staged.queueId,
      decision: 'approved',
      callerOrigin: 'agent-rpc',
    });
    expect(agentAttempt.ok).toBe(false);
    if (!agentAttempt.ok) {
      expect(agentAttempt.humanGate).toBe('BLOCKED_POLICY');
      expect(agentAttempt.code).toBe('COPILOT_HUMAN_APPROVAL_REQUIRED');
    }

    const humanDecision = await queue.decide({
      queueId: staged.queueId,
      decision: 'approved',
      callerOrigin: 'extension-popup',
    });
    expect(humanDecision.ok).toBe(true);
    if (humanDecision.ok) {
      expect(humanDecision.item.status).toBe('approved');
      expect(humanDecision.item.sent).toBe(false);
    }
  });
});
