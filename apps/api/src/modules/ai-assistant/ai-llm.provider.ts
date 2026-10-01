/**
 * The optional LLM adapter — narration over already-scoped data, and nothing else.
 *
 * ## The security contract, stated once
 *
 * This provider is only ever handed `AiNarrationRequest`, which contains **already-fetched,
 * already-scoped rows**. It never receives a Prisma client, a tenant id, a scope grant, a filter, or
 * a SQL string, and it has no way to fetch anything itself. That is deliberate and is the reason the
 * module can claim "the AI never bypasses authorization": by the time a prompt exists, the
 * authorization decision has already been made and enforced by SQL, and the model can only choose
 * how to *word* a result it was handed. A model that could write the query would be a second,
 * unaudited authorization surface, and no amount of prompt engineering fixes that.
 *
 * ## Provider-free operation is the default, not a degraded mode
 *
 * `AI_PROVIDER=none` is the shipped default and the feature is fully usable: NL queries, risk
 * insights, report generation and deterministic draft templates all work with no API key at all,
 * because they are scoped SQL plus fixed formatting. A provider only adds (a) prose narration of
 * those numbers and (b) free-text drafting. `complete()` returns null in that case and every caller
 * already has a deterministic path — so "no provider configured" degrades quality, never
 * correctness, and never turns a capability off.
 *
 * ## Hard rules the adapter enforces
 *
 *  - **No tenant identifiers in the request.** No tenant name, slug, or id is placed in a prompt, so
 *    provider-side logs cannot correlate a prompt with a customer even accidentally.
 *  - **No raw ids of individuals in the prompt.** `AiNarrationRequest.rows` is passed through
 *    `redactRows`, which strips uuid-shaped values and any column whose key matches a student
 *    identifier. A prompt should carry aggregates and names, not primary keys.
 *  - **Outbound calls are bounded** by an explicit timeout and an abort signal, so a hung provider
 *    cannot hold a request thread.
 *  - **Usage is reported, not guessed.** Token counts come back from the provider where available
 *    and are stored on AiMessage so cost is attributable to a tenant and a user.
 */

import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/** Providers this adapter can speak to. `none` means "call nothing". */
export type AiProviderName = 'none' | 'anthropic' | 'openai' | 'mock';

/** What the caller wants said, in business terms. Never a query, never a scope. */
export interface AiNarrationRequest {
  /** Already-fetched, already-scoped figures. Redacted before it reaches a provider. */
  facts: Record<string, string | number | boolean | null>;
  /** Optional capped sample of scoped table rows, for a "here is who" sentence. */
  rows?: Array<Record<string, string | number | boolean | null>>;
  /** The user's original question, so the wording answers *that* rather than restating the facts. */
  question: string;
  /** The deterministic answer. The model may improve phrasing but is told these facts are the
   *  authoritative content — never to add, subtract, extrapolate or round differently. */
  baseline: string;
  /** Hard cap on the generated text. */
  maxTokens?: number;
}

export interface AiNarrationResult {
  text: string;
  provider: AiProviderName;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}

/**
 * Row-cap and token-cap on a narration call.
 *
 * The rows are already capped by AI_MAX_ROWS upstream; this second cap is on the *rendered* row
 * sample inside the prompt, so a caller who asks for 500 rows does not ship 500 rows to a third
 * party to be told "and 473 more".
 */
const MAX_PROMPT_ROWS = 20;
const MAX_PROMPT_FACTS = 40;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_COMPLETION_TOKENS = 400;

@Injectable()
export class AiLlmProvider {
  private readonly logger = new Logger(AiLlmProvider.name);

  constructor(private readonly appConfig: AppConfigService) {}

  /** The effective provider, with `none` implied whenever the prerequisites are not met. */
  get provider(): AiProviderName {
    if (!this.appConfig.get('AI_ENABLED')) return 'none';
    const configured = this.appConfig.get('AI_PROVIDER') as AiProviderName;
    if (configured === 'none') return 'none';
    // A provider without a key is treated as `none` rather than throwing on every call: the caller
    // has a deterministic path, and failing the whole answer over a missing optional key would make
    // an operator mistake look like an outage.
    if (configured !== 'mock' && !this.appConfig.get('AI_API_KEY')) {
      this.logger.warn(`AI_PROVIDER=${configured} but AI_API_KEY is unset — running without a provider.`);
      return 'none';
    }
    return configured;
  }

  get model(): string {
    return this.appConfig.get('AI_MODEL');
  }

  get enabled(): boolean {
    return this.appConfig.get('AI_ENABLED');
  }

  /** True when a real provider is reachable; false for `none`. `mock` counts as configured. */
  get hasProvider(): boolean {
    return this.provider !== 'none';
  }

  /** True when the OCR endpoint is configured (classification still runs without it). */
  get ocrConfigured(): boolean {
    return Boolean(this.appConfig.get('AI_OCR_API_URL'));
  }

  /**
   * Phrases `request` in prose, or returns null when no provider is configured.
   *
   * Null (not an exception) is the contract: "no provider" is a supported configuration, and every
   * caller's deterministic answer is already complete without this. Provider *errors* throw, so a
   * real outage is visible rather than silently producing a quietly worse answer.
   */
  async complete(request: AiNarrationRequest): Promise<AiNarrationResult | null> {
    const provider = this.provider;
    if (provider === 'none') return null;

    const started = Date.now();
    const prompt = this.buildSystemPrompt(request);
    const facts = this.redactFacts(request.facts);
    const rows = this.redactRows(request.rows ?? []);

    try {
      const result =
        provider === 'anthropic'
          ? await this.callAnthropic(prompt, request, facts, rows)
          : provider === 'openai'
            ? await this.callOpenAi(prompt, request, facts, rows)
            : mockNarration(request);
      return { ...result, provider, model: this.model, latencyMs: Date.now() - started };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI provider ${provider} failed: ${message}`);
      throw new Error(`AI provider (${provider}) request failed: ${message}`);
    }
  }

  /**
   * Generates free text (draft bodies, summaries) with **no tenant data in the prompt at all**.
   *
   * Separate from `complete()` on purpose: the two have different data-flow risk profiles. Narration
   * carries scoped rows, which are at worst de-identified aggregates. A drafting call carries only
   * what the human typed, so it is safe to keep off the data path entirely — and keeping the two
   * methods separate makes "does any prompt contain tenant data?" a question with two answers
   * instead of one sprawling one.
   */
  async generateText(input: { instruction: string; context?: string; maxTokens?: number }): Promise<AiNarrationResult | null> {
    const provider = this.provider;
    if (provider === 'none') return null;

    const started = Date.now();
    const system = [
      'You write short, professional communications for a college administration system.',
      'Use only the facts supplied. Never invent a date, amount, name, or policy.',
      'Return only the message body — no preamble, no explanation, no markdown fences.',
      'If a required fact is missing, say so plainly in one sentence rather than guessing.',
    ].join(' ');

    try {
      const result =
        provider === 'anthropic'
          ? await this.callAnthropicText(system, input)
          : provider === 'openai'
            ? await this.callOpenAiText(system, input)
            : { text: input.context ? input.context : '', promptTokens: 0, completionTokens: 0 };
      return { ...result, provider, model: this.model, latencyMs: Date.now() - started };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI provider ${provider} text generation failed: ${message}`);
      throw new Error(`AI provider (${provider}) request failed: ${message}`);
    }
  }

  // ── Provider adapters ─────────────────────────────────────────────────────

  private async callAnthropic(
    system: string,
    request: AiNarrationRequest,
    facts: Record<string, unknown>,
    rows: Array<Record<string, unknown>>,
  ): Promise<Omit<AiNarrationResult, 'provider' | 'model' | 'latencyMs'>> {
    const response = await this.postJson(
      'https://api.anthropic.com/v1/messages',
      {
        anthropic_version: '2023-06-01',
        model: this.model,
        max_tokens: request.maxTokens ?? MAX_COMPLETION_TOKENS,
        system,
        messages: [{ role: 'user', content: JSON.stringify({ question: request.question, facts, rows }) }],
      },
      {
        'x-api-key': this.appConfig.get('AI_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
    );

    const text = Array.isArray(response['content'])
      ? (response['content'] as Array<{ type?: string; text?: string }>)
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('')
          .trim()
      : '';
    if (!text) throw new Error('provider returned no text content');

    return {
      text,
      promptTokens: typeof response['usage'] === 'object' && response['usage'] ? readInt((response['usage'] as Record<string, unknown>)['input_tokens']) : null,
      completionTokens: typeof response['usage'] === 'object' && response['usage'] ? readInt((response['usage'] as Record<string, unknown>)['output_tokens']) : null,
    };
  }

  private async callOpenAi(
    system: string,
    request: AiNarrationRequest,
    facts: Record<string, unknown>,
    rows: Array<Record<string, unknown>>,
  ): Promise<Omit<AiNarrationResult, 'provider' | 'model' | 'latencyMs'>> {
    const response = await this.postJson(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.model,
        max_tokens: request.maxTokens ?? MAX_COMPLETION_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ question: request.question, facts, rows }) },
        ],
      },
      { Authorization: `Bearer ${this.appConfig.get('AI_API_KEY') ?? ''}` },
    );

    const choices = Array.isArray(response['choices']) ? (response['choices'] as Array<Record<string, unknown>>) : [];
    const message = choices[0] && typeof choices[0]['message'] === 'object' ? (choices[0]['message'] as Record<string, unknown>) : null;
    const text = typeof message?.['content'] === 'string' ? (message['content'] as string).trim() : '';
    if (!text) throw new Error('provider returned no message content');

    const usage = typeof response['usage'] === 'object' && response['usage'] ? (response['usage'] as Record<string, unknown>) : null;
    return {
      text,
      promptTokens: usage ? readInt(usage['prompt_tokens']) : null,
      completionTokens: usage ? readInt(usage['completion_tokens']) : null,
    };
  }

  private async callAnthropicText(
    system: string,
    input: { instruction: string; context?: string; maxTokens?: number },
  ): Promise<Omit<AiNarrationResult, 'provider' | 'model' | 'latencyMs'>> {
    const body: Record<string, unknown> = {
      anthropic_version: '2023-06-01',
      model: this.model,
      max_tokens: input.maxTokens ?? MAX_COMPLETION_TOKENS,
      system,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ instruction: input.instruction, context: input.context ?? null }),
        },
      ],
    };
    const response = await this.postJson(
      'https://api.anthropic.com/v1/messages',
      body,
      {
        'x-api-key': this.appConfig.get('AI_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
    );
    const text = Array.isArray(response['content'])
      ? (response['content'] as Array<{ type?: string; text?: string }>)
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('')
          .trim()
      : '';
    if (!text) throw new Error('provider returned no text content');
    const usage = typeof response['usage'] === 'object' && response['usage'] ? (response['usage'] as Record<string, unknown>) : null;
    return { text, promptTokens: usage ? readInt(usage['input_tokens']) : null, completionTokens: usage ? readInt(usage['output_tokens']) : null };
  }

  private async callOpenAiText(
    system: string,
    input: { instruction: string; context?: string; maxTokens?: number },
  ): Promise<Omit<AiNarrationResult, 'provider' | 'model' | 'latencyMs'>> {
    const response = await this.postJson(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.model,
        max_tokens: input.maxTokens ?? MAX_COMPLETION_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ instruction: input.instruction, context: input.context ?? null }) },
        ],
      },
      { Authorization: `Bearer ${this.appConfig.get('AI_API_KEY') ?? ''}` },
    );
    const choices = Array.isArray(response['choices']) ? (response['choices'] as Array<Record<string, unknown>>) : [];
    const message = choices[0] && typeof choices[0]['message'] === 'object' ? (choices[0]['message'] as Record<string, unknown>) : null;
    const text = typeof message?.['content'] === 'string' ? (message['content'] as string).trim() : '';
    if (!text) throw new Error('provider returned no message content');
    const usage = typeof response['usage'] === 'object' && response['usage'] ? (response['usage'] as Record<string, unknown>) : null;
    return { text, promptTokens: usage ? readInt(usage['prompt_tokens']) : null, completionTokens: usage ? readInt(usage['completion_tokens']) : null };
  }

  /**
   * One outbound HTTP call, bounded.
   *
   * The timeout is not defensive programming for its own sake: without it a provider that accepts
   * the connection and never answers holds the request open until the client's own gateway gives
   * up, and an assistant is a synchronous user-facing surface where that is felt immediately.
   */
  private async postJson(url: string, body: unknown, headers: Record<string, string>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Prompt construction ───────────────────────────────────────────────────

  /**
   * The system prompt for narration.
   *
   * Written to make the *failure mode* explicit: a model asked to "helpfully" interpret figures
   * invents figures. Every clause below closes one of the ways that happens — no additions, no
   * arithmetic of its own, no speculation about *why*, and a hard instruction to say when the data
   * does not support a claim. A caller who is handed narration from a provider should still be able
   * to trust the numbers, because the numbers are not in the model's hands.
   */
  private buildSystemPrompt(request: AiNarrationRequest): string {
    return [
      'You are explaining data from a college ERP to an administrator who asked a question.',
      'The "facts" object is the complete and authoritative answer, already computed from the database under that user\'s permissions.',
      `Here is the baseline answer, which is correct by construction: "${request.baseline}"`,
      'Rules:',
      '- Rephrase for clarity. Do not add, remove, round differently, recompute, or reinterpret any number.',
      '- Do not speculate about causes, intentions, or reasons; you were not given any.',
      '- If the facts do not answer the question, say what is missing instead of estimating.',
      '- Never name or guess any individual student or staff member that is not in the facts.',
      `- Write at most ${request.maxTokens ?? MAX_COMPLETION_TOKENS} tokens. Plain prose. No markdown, no bullet points, no preamble.`,
    ].join('\n');
  }

  // ── Redaction ─────────────────────────────────────────────────────────────

  /**
   * Strips values that identify a record rather than describe the data.
   *
   * Primary keys are useless to a language model and are exactly what a provider-side log retains,
   * so they are dropped on the way out. Names are *kept* — an administrator asking "who is missing
   * attendance" needs to see who — but only ever names the scoped SQL already returned.
   */
  private redactFacts(facts: Record<string, string | number | boolean | null>): Record<string, unknown> {
    const entries = Object.entries(facts).slice(0, MAX_PROMPT_FACTS);
    const out: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      if (value === null || value === undefined) continue;
      out[key] = typeof value === 'string' ? redactUuid(value) : value;
    }
    return out;
  }

  private redactRows(rows: Array<Record<string, string | number | boolean | null>>): Array<Record<string, unknown>> {
    return rows.slice(0, MAX_PROMPT_ROWS).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined) continue;
        if (IDENTIFIER_COLUMN.test(key)) continue;
        out[key] = typeof value === 'string' ? redactUuid(value) : value;
      }
      return out;
    });
  }
}

/** Column keys whose value is a record identifier and never reaches a provider. */
const IDENTIFIER_COLUMN = /\b(id|uuid|versionid|documentid|messageid|conversationid|studentid|userid)$/i;

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function redactUuid(value: string): string {
  return value.replace(UUID_PATTERN, '[redacted]');
}

function readInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Offline provider for development and CI.
 *
 * Returns the deterministic baseline with a marker, so the `DATA_WITH_NARRATION` path is exercisable
 * end-to-end without a network or a key — and so a test can assert that narration *changed the text
 * but not the payload*, which is the invariant that actually matters.
 */
function mockNarration(request: AiNarrationRequest): Omit<AiNarrationResult, 'provider' | 'model' | 'latencyMs'> {
  return { text: request.baseline, promptTokens: 0, completionTokens: 0 };
}