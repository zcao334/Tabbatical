/**
 * When to interrupt.
 *
 * The badge is passive: it answers a question the user thought to ask. This
 * decides when to ask *them*, which is a different and much easier thing to get
 * wrong — an interruption that arrives at the wrong moment, or twice, teaches
 * the user to dismiss it on sight, and a prompt that has been trained away is
 * worse than no prompt at all.
 *
 * Kept free of chrome APIs so every one of those rules can be tested directly.
 */

import { MS_PER_DAY, MS_PER_MINUTE } from './types';

export interface PromptConfig {
  /** Whether the daily prompt fires at all. */
  enabled: boolean;
  /**
   * How many tabs the prompt offers to review.
   *
   * The number that matters is how many the user is *asked about*, not how
   * many are stale. "Review 5 tabs" is a question with an end; "47 tabs are
   * stale" is a reason to close the notification.
   */
  batchSize: number;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  enabled: true,
  batchSize: 5,
};

export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 25;

/** At most one prompt in this window, however many times the alarm fires. */
export const PROMPT_INTERVAL_MS = MS_PER_DAY;

/**
 * How long after the browser starts to leave the user alone.
 *
 * First use of the day is the right moment to ask, but its first minutes are
 * when they opened the browser to do something specific. Waiting a little is
 * the difference between a prompt that feels timed and one that feels like it
 * was lying in wait.
 */
export const STARTUP_GRACE_MS = 5 * MS_PER_MINUTE;

export interface PromptDecision {
  now: number;
  /** When the last prompt was *shown*, not when it was acted on. */
  lastPromptedAt: number;
  /** When this browser session started. */
  sessionStartedAt: number;
  /** How many tabs currently clear the review threshold. */
  dueCount: number;
  config: PromptConfig;
}

/**
 * Whether to prompt right now.
 *
 * Every clause here is a way of not being annoying, so each is worth stating:
 * the user can turn it off; there has to be something to say; the browser has
 * to have been up long enough that this isn't the first thing they see; and a
 * day has to have passed since they were last asked.
 */
export function shouldPrompt({
  now,
  lastPromptedAt,
  sessionStartedAt,
  dueCount,
  config,
}: PromptDecision): boolean {
  if (!config.enabled) return false;
  if (dueCount <= 0) return false;
  if (now - sessionStartedAt < STARTUP_GRACE_MS) return false;
  // A future timestamp means a clock that moved backwards, not a prompt that
  // hasn't happened yet. Treating it as "recently prompted" errs toward
  // silence, which is the safe direction for an interruption.
  if (now - lastPromptedAt < PROMPT_INTERVAL_MS) return false;
  return true;
}

/** How many tabs this prompt should offer — never more than there are. */
export function promptBatchFor(dueCount: number, config: PromptConfig): number {
  return Math.max(0, Math.min(dueCount, config.batchSize));
}

/**
 * What the notification says.
 *
 * Names the batch rather than the backlog, and asks a question, because the
 * whole point is that it's answerable. The backlog is mentioned only when it
 * is bigger than the batch, where it explains why this is a subset.
 */
export function promptMessage(dueCount: number, config: PromptConfig): string {
  const batch = promptBatchFor(dueCount, config);
  const tabs = batch === 1 ? 'tab' : 'tabs';

  if (dueCount > batch) {
    return `${dueCount} tabs haven't been touched in a while. Review ${batch} of them?`;
  }
  return `${batch} ${tabs} haven't been touched in a while. Review ${batch === 1 ? 'it' : 'them'}?`;
}

/**
 * How the prompt's two settings describe themselves.
 *
 * Same shape as a staleness weight, so the settings form renders both from one
 * pair of field builders rather than growing a second layout for the sake of
 * two controls.
 */
export const PROMPT_ENABLED_FIELD = {
  key: 'enabled',
  label: 'Ask me once a day',
  hint: 'A notification when tabs are due, so a review starts without you thinking of it.',
};

export const PROMPT_BATCH_FIELD = {
  key: 'batchSize',
  label: 'Tabs to offer each time',
  hint: 'Kept small on purpose — a prompt you can finish is one you answer.',
  min: MIN_BATCH_SIZE,
  max: MAX_BATCH_SIZE,
};

/** Coerce a stored record into a usable config, per-key, like the weights. */
export function sanitizePromptConfig(stored: unknown): PromptConfig {
  const source = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<
    string,
    unknown
  >;

  const config = { ...DEFAULT_PROMPT_CONFIG };

  if (typeof source.enabled === 'boolean') config.enabled = source.enabled;
  if (typeof source.batchSize === 'number' && Number.isFinite(source.batchSize)) {
    config.batchSize = Math.round(
      Math.min(Math.max(source.batchSize, MIN_BATCH_SIZE), MAX_BATCH_SIZE),
    );
  }

  return config;
}
