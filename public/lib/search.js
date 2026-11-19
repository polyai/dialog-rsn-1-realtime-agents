/**
 * A keyword search over topics, for the examples' search tools. Swap in your own search:
 * vector, BM25, an API. Whatever it is, return topics ({name, content, actions?}) and hand
 * them back with withKnowledge(), so the model can answer from them and cite them.
 */
const STOP = new Set(["the", "and", "for", "you", "your", "how", "what", "can", "does", "with", "my", "is", "do", "i", "a", "to", "of", "on", "in", "it", "are", "have"]);
const words = (s) => String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * @param {Array<object>} docs
 * @param {string} query
 * @param {{ limit?: number, text?: (doc: object) => string }} [opts] `text` is what's
 *        searched; by default the name (twice, so it counts more) and the content
 */
export function keywordSearch(docs, query, { limit = 3, text = (d) => `${d.name} ${d.name} ${d.content}` } = {}) {
  const q = words(query);
  return docs
    .map((d) => {
      const t = words(text(d));
      return { d, score: q.reduce((n, w) => n + t.filter((x) => x.startsWith(w) || w.startsWith(x)).length, 0) };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.d);
}

/** What poly_knowledge takes: name and content, and actions where a topic has them. */
export const asTopic = ({ name, content, actions }) => (actions ? { name, content, actions } : { name, content });
