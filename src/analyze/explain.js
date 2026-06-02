// Plain-language explanation of WHY two changes clash. Optional: requires
// @anthropic-ai/sdk and ANTHROPIC_API_KEY. Without them, quietclash falls back to
// a structural explanation derived from the source diff — still useful, just
// not prose. Explanation is a nicety on top of detection; detection never
// depends on it.

const MODEL = 'claude-haiku-4-5-20251001'; // cheap + fast; explanations are short

// Build a fallback explanation from the evidence alone (no LLM).
function structuralExplanation(conflict) {
  const ex = conflict.evidence?.[0];
  if (!ex) return null;
  const { base, a, b, m } = ex.detail;
  return (
    `On input ${JSON.stringify(ex.input)}: base returned ${base}; branch A made it ${a}; ` +
    `branch B made it ${b}; the merged result is ${m}. The merge does not reflect both intents.`
  );
}

// Try the Claude API; return prose or null. Uses prompt caching on the static
// instruction block so repeated calls in one run stay cheap.
async function llmExplanation(conflict) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return null; // optional dependency not installed
  }
  const client = new Anthropic();

  const aText = conflict.branches?.find((x) => /a/i.test(x.branch))?.branchText;
  const bText = conflict.branches?.find((x) => /b/i.test(x.branch))?.branchText;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: [
        {
          type: 'text',
          text:
            'You explain silent behavioral merge conflicts between two parallel code changes. ' +
            'Given two versions of a symbol and probe evidence that the merged behavior matches ' +
            "neither, explain in ONE or TWO sentences, concretely, why they clash and what breaks. " +
            'No preamble. Reference the actual behavior change.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content:
            `Symbol: ${conflict.symbol}\n` +
            `Branch A version:\n${aText || '(unavailable)'}\n\n` +
            `Branch B version:\n${bText || '(unavailable)'}\n\n` +
            `Probe evidence: ${JSON.stringify(conflict.evidence?.slice(0, 3) || [])}\n` +
            `Conflict kind: ${conflict.dominantKind}`,
        },
      ],
    });
    const text = msg.content?.find((b) => b.type === 'text')?.text?.trim();
    return text || null;
  } catch {
    return null; // network/auth failure -> fall back silently
  }
}

// Attach an `.explanation` string to each conflict (LLM if available, else
// structural). Mutates and returns the conflicts array.
export async function explainConflicts(conflicts) {
  for (const cf of conflicts) {
    cf.explanation = (await llmExplanation(cf)) || structuralExplanation(cf);
  }
  return conflicts;
}
