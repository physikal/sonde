import Anthropic from '@anthropic-ai/sdk';
import type { SondeDb, TrendingSummary } from '../db/index.js';
import { formatSummaryText } from '../mcp/tools/trending.js';

const SYSTEM_PROMPT = `You are an infrastructure diagnostics analyst for Sonde, an AI-powered infrastructure monitoring platform. You receive aggregate probe trending data from the last N hours.

Analyze failure patterns, identify likely root causes, and recommend specific next diagnostic steps using Sonde's MCP tools (diagnose, probe, query_logs). Be concise and actionable. Format with markdown.

Structure your response as:
1. **Summary** — one-sentence overall assessment
2. **Key Findings** — top failure patterns with likely causes
3. **Recommended Actions** — specific Sonde commands/probes to run next`;

const ANALYSIS_TTL_MS = 5 * 60 * 1000;

interface Subscriber {
  onChunk: (chunk: string, done: boolean) => void;
}

interface ActiveAnalysis {
  hours: number;
  text: string;
  complete: boolean;
  startedAt: number;
  subscribers: Set<Subscriber>;
}

let activeAnalysis: ActiveAnalysis | null = null;

export function getAnalysisStatus(): {
  active: boolean;
  complete: boolean;
  hours?: number;
  text?: string;
} {
  if (!activeAnalysis) {
    return { active: false, complete: false };
  }

  if (activeAnalysis.complete) {
    const age = Date.now() - activeAnalysis.startedAt;
    if (age > ANALYSIS_TTL_MS) {
      activeAnalysis = null;
      return { active: false, complete: false };
    }
  }

  return {
    active: !activeAnalysis.complete,
    complete: activeAnalysis.complete,
    hours: activeAnalysis.hours,
    text: activeAnalysis.text,
  };
}

async function runAnalysis(
  apiKey: string,
  model: string,
  trendingData: string,
  analysis: ActiveAnalysis,
): Promise<void> {
  try {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trendingData }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        analysis.text += chunk;
        for (const sub of analysis.subscribers) {
          sub.onChunk(chunk, false);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    const errorChunk = `\n\n**Error:** ${msg}`;
    analysis.text += errorChunk;
    for (const sub of analysis.subscribers) {
      sub.onChunk(errorChunk, false);
    }
  } finally {
    analysis.complete = true;
    for (const sub of analysis.subscribers) {
      sub.onChunk('', true);
    }
    analysis.subscribers.clear();
  }
}

export function startOrJoinAnalysis(
  hours: number,
  apiKey: string,
  model: string,
  db: SondeDb,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  // Expired completed analysis — clear it
  if (activeAnalysis?.complete) {
    const age = Date.now() - activeAnalysis.startedAt;
    if (age > ANALYSIS_TTL_MS) {
      activeAnalysis = null;
    }
  }

  // Completed analysis still valid — return full text immediately
  if (activeAnalysis?.complete) {
    const completedText = activeAnalysis.text;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(completedText));
        controller.close();
      },
    });
  }

  // Active analysis in progress — replay buffered text + subscribe
  if (activeAnalysis && !activeAnalysis.complete) {
    const analysis = activeAnalysis;
    return new ReadableStream({
      start(controller) {
        // Replay existing text
        if (analysis.text.length > 0) {
          controller.enqueue(encoder.encode(analysis.text));
        }

        const sub: Subscriber = {
          onChunk(chunk, done) {
            try {
              if (chunk.length > 0) {
                controller.enqueue(encoder.encode(chunk));
              }
              if (done) {
                controller.close();
              }
            } catch {
              // Stream already closed by client
              analysis.subscribers.delete(sub);
            }
          },
        };
        analysis.subscribers.add(sub);
      },
      cancel() {
        // Clean up subscriber if client disconnects
      },
    });
  }

  // No active analysis — start a new one
  const summary: TrendingSummary = db.getTrendingSummary(hours);
  const trendingText = formatSummaryText(summary, hours);

  const analysis: ActiveAnalysis = {
    hours,
    text: '',
    complete: false,
    startedAt: Date.now(),
    subscribers: new Set(),
  };
  activeAnalysis = analysis;

  // Start the streaming analysis (fire-and-forget)
  runAnalysis(apiKey, model, trendingText, analysis);

  return new ReadableStream({
    start(controller) {
      const sub: Subscriber = {
        onChunk(chunk, done) {
          try {
            if (chunk.length > 0) {
              controller.enqueue(encoder.encode(chunk));
            }
            if (done) {
              controller.close();
            }
          } catch {
            analysis.subscribers.delete(sub);
          }
        },
      };
      analysis.subscribers.add(sub);
    },
    cancel() {
      // Client disconnected
    },
  });
}
