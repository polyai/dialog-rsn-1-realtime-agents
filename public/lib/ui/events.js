/**
 * The event log: every event to and from each session, newest at the bottom. Click a row
 * for its full payload. Caller audio (`input_audio_buffer.append`, ten a second) is counted
 * rather than listed.
 */
const MAX_ROWS = 2000;

export class EventLog {
  constructor(root, filterInput) {
    this.root = root;
    this.filter = "";
    filterInput?.addEventListener("input", () => {
      this.filter = filterInput.value.trim().toLowerCase();
      for (const row of this.root.children) row.hidden = !this.matches(row.dataset.type);
    });
  }

  clear() {
    this.root.replaceChildren();
  }

  matches(type) {
    return !this.filter || type.includes(this.filter);
  }

  /** Show everything one session sends and receives. */
  attach(session) {
    session.on("sent", ({ event }) => this.add("out", session.label, event));
    session.on("*", (event) => this.add("in", session.label, event));
  }

  add(direction, label, event) {
    const stick = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 60;
    const row = document.createElement("details");
    row.className = `event ${direction} ${event.type === "error" ? "error" : ""}`;
    row.dataset.type = event.type;
    row.hidden = !this.matches(event.type);
    const summary = document.createElement("summary");
    const time = new Date().toISOString().slice(11, 23);
    summary.innerHTML = `<span class="t"></span><span class="dir"></span><span class="who"></span><span class="type"></span>`;
    summary.querySelector(".t").textContent = time;
    summary.querySelector(".dir").textContent = direction === "out" ? "▲" : "▼";
    summary.querySelector(".dir").title = direction === "out" ? "sent" : "received";
    summary.querySelector(".who").textContent = label;
    summary.querySelector(".type").textContent = event.type;
    row.append(summary);
    // Build the payload only when someone opens the row: most never are.
    row.addEventListener("toggle", () => {
      if (row.open && !row.querySelector("pre")) {
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(event, null, 2);
        row.append(pre);
      }
    });
    this.root.append(row);
    while (this.root.children.length > MAX_ROWS) this.root.firstChild.remove();
    if (stick) this.root.scrollTop = this.root.scrollHeight;
  }
}
