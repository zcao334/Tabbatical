import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_CONFIG,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  PROMPT_INTERVAL_MS,
  STARTUP_GRACE_MS,
  promptBatchFor,
  promptMessage,
  sanitizePromptConfig,
  shouldPrompt,
  type PromptDecision,
} from './prompt';

const NOW = new Date('2026-08-19T09:00:00Z').getTime();

/** A profile that is due a prompt: everything permits it unless overridden. */
function decision(overrides: Partial<PromptDecision> = {}): PromptDecision {
  return {
    now: NOW,
    lastPromptedAt: NOW - PROMPT_INTERVAL_MS - 1,
    sessionStartedAt: NOW - STARTUP_GRACE_MS - 1,
    dueCount: 8,
    config: DEFAULT_PROMPT_CONFIG,
    ...overrides,
  };
}

describe('shouldPrompt', () => {
  it('prompts when everything lines up', () => {
    expect(shouldPrompt(decision())).toBe(true);
  });

  it('says nothing when the user has turned it off', () => {
    expect(shouldPrompt(decision({ config: { ...DEFAULT_PROMPT_CONFIG, enabled: false } }))).toBe(
      false,
    );
  });

  it('says nothing when no tabs are due', () => {
    // Which is also why this can't fire on a fresh profile: nothing is stale
    // yet, so the feature stays silent until it has something to say.
    expect(shouldPrompt(decision({ dueCount: 0 }))).toBe(false);
  });

  it('waits out the startup grace period', () => {
    // The first minutes after launch are when the user opened the browser to
    // do something else.
    expect(shouldPrompt(decision({ sessionStartedAt: NOW - STARTUP_GRACE_MS + 1 }))).toBe(false);
  });

  it('prompts once the grace period has passed', () => {
    expect(shouldPrompt(decision({ sessionStartedAt: NOW - STARTUP_GRACE_MS }))).toBe(true);
  });

  it('does not prompt twice in a day', () => {
    // The alarm ticks every 30 minutes; without this it would prompt on each.
    expect(shouldPrompt(decision({ lastPromptedAt: NOW - PROMPT_INTERVAL_MS + 1 }))).toBe(false);
  });

  it('prompts again once a full day has passed', () => {
    expect(shouldPrompt(decision({ lastPromptedAt: NOW - PROMPT_INTERVAL_MS }))).toBe(true);
  });

  it('prompts a profile that has never been prompted', () => {
    expect(shouldPrompt(decision({ lastPromptedAt: 0 }))).toBe(true);
  });

  it('stays quiet when the clock has moved backwards', () => {
    // A timestamp in the future is a clock change, not a prompt owed. Erring
    // toward silence is the safe direction for an interruption.
    expect(shouldPrompt(decision({ lastPromptedAt: NOW + PROMPT_INTERVAL_MS }))).toBe(false);
  });
});

describe('promptBatchFor', () => {
  it('offers the configured batch', () => {
    expect(promptBatchFor(40, DEFAULT_PROMPT_CONFIG)).toBe(DEFAULT_PROMPT_CONFIG.batchSize);
  });

  it('never offers more tabs than are actually due', () => {
    expect(promptBatchFor(2, DEFAULT_PROMPT_CONFIG)).toBe(2);
  });

  it('never goes negative', () => {
    expect(promptBatchFor(0, DEFAULT_PROMPT_CONFIG)).toBe(0);
  });
});

describe('promptMessage', () => {
  it('names the batch, not the backlog', () => {
    // "47 tabs are stale" is a reason to dismiss; a bounded ask is answerable.
    const message = promptMessage(47, DEFAULT_PROMPT_CONFIG);

    expect(message).toContain('Review 5');
  });

  it('mentions the backlog only when it is bigger than the batch', () => {
    expect(promptMessage(3, DEFAULT_PROMPT_CONFIG)).not.toMatch(/of them/);
  });

  it('reads correctly for a single tab', () => {
    const message = promptMessage(1, DEFAULT_PROMPT_CONFIG);

    expect(message).toContain('1 tab ');
    expect(message).not.toContain('1 tabs');
  });
});

describe('sanitizePromptConfig', () => {
  it('takes a stored config as given', () => {
    expect(sanitizePromptConfig({ enabled: false, batchSize: 10 })).toEqual({
      enabled: false,
      batchSize: 10,
    });
  });

  it('defaults anything missing', () => {
    expect(sanitizePromptConfig({ enabled: false })).toEqual({
      ...DEFAULT_PROMPT_CONFIG,
      enabled: false,
    });
  });

  it('rejects a non-boolean enabled, including the strings storage might hold', () => {
    for (const bad of ['false', 0, null, {}]) {
      expect(sanitizePromptConfig({ enabled: bad }).enabled).toBe(DEFAULT_PROMPT_CONFIG.enabled);
    }
  });

  it('clamps the batch size to something a person can finish', () => {
    expect(sanitizePromptConfig({ batchSize: 500 }).batchSize).toBe(MAX_BATCH_SIZE);
    expect(sanitizePromptConfig({ batchSize: 0 }).batchSize).toBe(MIN_BATCH_SIZE);
  });

  it('rounds a fractional batch size', () => {
    // "Review 4.5 tabs" is not a thing to ask anyone.
    expect(sanitizePromptConfig({ batchSize: 4.5 }).batchSize).toBe(5);
  });

  it('rejects NaN and infinities', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(sanitizePromptConfig({ batchSize: bad }).batchSize).toBe(
        DEFAULT_PROMPT_CONFIG.batchSize,
      );
    }
  });

  it('returns the defaults for input that is not an object', () => {
    for (const bad of [undefined, null, 'nonsense', 42]) {
      expect(sanitizePromptConfig(bad)).toEqual(DEFAULT_PROMPT_CONFIG);
    }
  });

  it('is on by default, so it reaches a user who never opens Settings', () => {
    expect(DEFAULT_PROMPT_CONFIG.enabled).toBe(true);
  });
});
