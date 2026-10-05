/**
 * The transcript pane: caller and agent messages, tool calls and results, handoffs, and what
 * Dialog-RSN-1 reports on each reply (the knowledge it cited, and whether the request was
 * outside what the agent handles).
 */
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const json = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export class Transcript {
  constructor(root) {
    this.root = root;
    this.users = new Map(); // item id -> element
    this.agents = new Map(); // response id -> {row, body}
    this.tools = new Map(); // call id -> element
  }

  clear() {
    this.root.replaceChildren();
    this.users.clear();
    this.agents.clear();
    this.tools.clear();
  }

  add(node) {
    const stick = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 80;
    this.root.append(node);
    if (stick) this.root.scrollTop = this.root.scrollHeight;
    return node;
  }

  user(id, text, { pending = false, typed = false } = {}) {
    let row = id && this.users.get(id);
    if (!row) {
      row = this.add(el("div", "msg user"));
      row.append(el("div", "who", typed ? "You, typed" : "You"), el("div", "bubble"));
      if (id) this.users.set(id, row);
    }
    row.querySelector(".bubble").textContent = text || (pending ? "…" : "");
    row.classList.toggle("pending", pending && !text);
    return row;
  }

  agentText(responseId, agentName, text) {
    let a = this.agents.get(responseId);
    if (!a) {
      const row = this.add(el("div", "msg agent"));
      const body = el("div", "bubble");
      row.append(el("div", "who", agentName), body, el("div", "meta"));
      a = { row, body, text: "" };
      this.agents.set(responseId, a);
    }
    a.text = text;
    if (!a.heard) a.body.textContent = text;
  }

  /** After a barge-in: show what the caller heard, and fade what they didn't. */
  heard(responseId, heardText) {
    const a = this.agents.get(responseId);
    if (!a) return;
    a.heard = true;
    const full = a.text;
    const cut = heardText ? Math.min(full.length, prefixLength(full, heardText)) : 0;
    a.body.replaceChildren(document.createTextNode(full.slice(0, cut)), el("span", "unheard", full.slice(cut)));
    this.chip(responseId, "Interrupted", "warn", heardText ? `The caller heard: "${heardText}"` : "The caller heard none of it");
  }

  chip(responseId, label, kind = "", title = "") {
    const a = this.agents.get(responseId);
    if (!a) return false;
    const c = el("span", `chip ${kind}`, label);
    if (title) c.title = title;
    a.row.querySelector(".meta").append(c);
    return true;
  }

  /** What `response.done` reports: cited knowledge and the out-of-domain judgement. */
  annotate(response) {
    const id = response.id;
    for (const topic of response.poly_cited_topics ?? []) {
      if (!this.chip(id, topic, "cite", "poly_cited_topics: the model answered from this knowledge")) this.crumb(`Cited ${topic}`, null, "cite");
    }
    if (response.poly_out_of_domain === true) {
      if (!this.chip(id, "Out of domain", "warn", "poly_out_of_domain: Dialog-RSN-1 judged this outside what the agent is deployed to handle")) {
        this.crumb("Out of domain", { response_id: id }, "warn");
      }
    }
    if (response.status === "failed") this.crumb(`Response failed: ${response.status_details?.error?.message ?? "no details"}`, response.status_details, "error");
  }

  toolCall(call) {
    const row = this.add(el("details", "tool"));
    const summary = el("summary");
    summary.append(el("span", "tool-name", call.name), el("span", "tool-status", "running"));
    const args = { ...call.args };
    row.append(summary, el("div", "label", "Arguments"), el("pre", "", json(args)));
    this.tools.set(call.call_id, row);
  }

  toolResult({ call, output, knowledge, error, ms }) {
    const row = this.tools.get(call.call_id);
    if (!row) return;
    const status = row.querySelector(".tool-status");
    if (error) {
      status.textContent = error;
      row.classList.add("dropped");
      return;
    }
    status.textContent = ms !== undefined ? `${ms} ms` : "done";
    row.append(el("div", "label", "Output"), el("pre", "", json(output)));
    if (knowledge?.length) {
      row.append(el("div", "label", "Knowledge sent as poly_knowledge"));
      row.append(el("pre", "", knowledge.map((k) => `${k.name}: ${k.content}`).join("\n\n")));
    }
  }

  crumb(title, data, kind = "") {
    const row = this.add(el(data ? "details" : "div", `crumb ${kind}`));
    if (data) {
      const s = el("summary", "", title);
      row.append(s, el("pre", "", json(data)));
    } else row.textContent = title;
    return row;
  }
}

/** How much of `full` the heard text covers, matching words loosely (punctuation aside). */
function prefixLength(full, heard) {
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const hw = heard.split(/\s+/).filter(Boolean).map(norm);
  const re = /\S+/g;
  let m, i = 0, end = 0;
  while ((m = re.exec(full)) && i < hw.length) {
    if (norm(m[0]) !== hw[i]) break;
    end = m.index + m[0].length;
    i++;
  }
  return end;
}
