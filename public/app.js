/**
 * The page: picks a scenario, connects a voice session through the relay, and wires the
 * microphone, the voice, the transcript and the event log to it.
 */
import { RealtimeSession } from "./lib/session.js";
import { AgentRunner } from "./lib/agents.js";
import { BrowserVoice, CartesiaVoice, CARTESIA_VOICES } from "./lib/speech.js";
import { INPUT_FORMATS, startMic } from "./lib/audio/mic.js";
import { Transcript } from "./lib/ui/transcript.js";
import { EventLog } from "./lib/ui/events.js";
import { allAgentSets, defaultAgentSetKey, labels } from "./scenarios/index.js";

const $ = (id) => document.getElementById(id);
const wsUrl = (path) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
const relay = () => new WebSocket(wsUrl("/realtime"));

const server = await fetch("/config").then((r) => r.json()).catch(() => ({ cartesia: false }));
const transcript = new Transcript($("transcript"));
const log = new EventLog($("events"), $("eventFilter"));

// ---- Preferences (this browser only) ---------------------------------------------------

const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem("rsn-agents") ?? "{}");
  } catch {
    return {};
  }
})();
function savePrefs() {
  try {
    localStorage.setItem("rsn-agents", JSON.stringify(prefs));
  } catch {}
}

// ---- Scenario and agent pickers ----------------------------------------------------------

const params = new URLSearchParams(location.search);
let scenarioKey = allAgentSets[params.get("scenario")] ? params.get("scenario") : defaultAgentSetKey;
let agentName = params.get("agent");

function fillPickers() {
  $("scenario").replaceChildren(...Object.keys(allAgentSets).map((k) => new Option(labels[k] ?? k, k)));
  $("scenario").value = scenarioKey;
  const agents = allAgentSets[scenarioKey];
  if (!agents.some((a) => a.name === agentName)) agentName = agents[0].name;
  $("agent").replaceChildren(...agents.map((a) => new Option(a.name, a.name)));
  $("agent").value = agentName;
  const url = new URL(location.href);
  url.searchParams.set("scenario", scenarioKey);
  url.searchParams.set("agent", agentName);
  history.replaceState(null, "", url);
}

$("scenario").addEventListener("change", () => {
  scenarioKey = $("scenario").value;
  agentName = null;
  if (call) disconnect();
  fillPickers();
  showEmpty();
});

$("agent").addEventListener("change", () => {
  agentName = $("agent").value;
  if (call) call.runner.switchTo(agentName);
  fillPickers();
});

// ---- Toolbar ---------------------------------------------------------------------------

$("inputFormat").replaceChildren(...Object.entries(INPUT_FORMATS).map(([k, f]) => new Option(f.label, k)));
$("inputFormat").value = INPUT_FORMATS[prefs.inputFormat] ? prefs.inputFormat : "pcm16";
$("ptt").checked = Boolean(prefs.ptt);
$("voiceOn").checked = prefs.voiceOn ?? true;
$("logs").checked = prefs.logs ?? true;
document.querySelector("main").classList.toggle("no-logs", !$("logs").checked);

function fillVoices() {
  const options = [];
  if (server.cartesia) for (const v of CARTESIA_VOICES) options.push(new Option(`Cartesia: ${v.label}`, `cartesia:${v.id}`));
  for (const v of BrowserVoice.voices()) options.push(new Option(`Browser: ${v.name}`, `browser:${v.name}`));
  if (!options.length) options.push(new Option("Browser: default", "browser:"));
  $("voice").replaceChildren(...options);
  $("voice").value = options.some((o) => o.value === prefs.voice) ? prefs.voice : options[0].value;
}
fillVoices();
speechSynthesis.addEventListener?.("voiceschanged", fillVoices);

$("inputFormat").addEventListener("change", async () => {
  prefs.inputFormat = $("inputFormat").value;
  savePrefs();
  // The format is fixed when the session starts: reconnect to switch.
  if (call) {
    disconnect("Reconnecting with the new input format");
    await connect();
  }
});

$("ptt").addEventListener("change", () => {
  prefs.ptt = $("ptt").checked;
  savePrefs();
  $("talk").disabled = !call || !$("ptt").checked;
});

$("voiceOn").addEventListener("change", async () => {
  prefs.voiceOn = $("voiceOn").checked;
  savePrefs();
  if (!call) return;
  stopVoice();
  if ($("voiceOn").checked) call.voice = await makeVoice(call.session);
});

$("voice").addEventListener("change", async () => {
  prefs.voice = $("voice").value;
  savePrefs();
  if (!call || !$("voiceOn").checked) return;
  stopVoice();
  call.voice = await makeVoice(call.session);
});

$("logs").addEventListener("change", () => {
  prefs.logs = $("logs").checked;
  savePrefs();
  document.querySelector("main").classList.toggle("no-logs", !$("logs").checked);
});

const talk = $("talk");
// Push to talk is a gate on the microphone: the caller's audio goes out only while the
// button is held, and silence the rest of the time. The server still decides when the turn
// has ended, as it does for open-mic speech. (Committing the buffer by hand on release, then
// asking for a response, is the textbook recipe, but on us-1 it sometimes produced an empty
// extra turn or no response at all.)
talk.addEventListener("pointerdown", (e) => {
  if (!call) return;
  e.preventDefault();
  // Pressing talk is a barge-in: stop the agent first.
  call.voice?.stopAll();
  call.session.cancel();
  call.talking = true;
  talk.classList.add("down");
});
const release = () => {
  if (!call?.talking) return;
  call.talking = false;
  talk.classList.remove("down");
};
talk.addEventListener("pointerup", release);
talk.addEventListener("pointerleave", release);

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || !call) return;
  $("text").value = "";
  call.voice?.stopAll();
  transcript.user(null, text, { typed: true });
  call.runner.say(text);
});

$("connect").addEventListener("click", () => (call ? disconnect() : connect()));

// ---- The call ----------------------------------------------------------------------------

let call = null; // { session, runner, voice, mic, talking }
let speaking = 0;

async function connect() {
  const button = $("connect");
  button.disabled = true;
  transcript.clear();
  log.clear();
  setStatus("connecting");

  const session = new RealtimeSession({ label: "voice", connect: relay });
  const runner = new AgentRunner({
    agents: allAgentSets[scenarioKey],
    start: agentName,
    session,
    // Tools that open sessions of their own (the supervisor, the returns reviewer) use these.
    extras: { connect: relay, onSession: (s) => log.attach(s) },
  });
  call = { session, runner, voice: null, mic: null, talking: false };
  log.attach(session);
  bind(session, runner);

  try {
    // Audio first, while this click still counts as a user gesture: browsers won't play
    // sound or open the mic otherwise.
    if ($("voiceOn").checked) call.voice = await makeVoice(session);
    const format = INPUT_FORMATS[$("inputFormat").value];
    try {
      call.mic = await startMic({
        format,
        onFrame: (audio, silence) => {
          if (!session.flags.ready) return;
          // With push to talk, send silence while the button is up rather than nothing: once
          // a session has had audio, the server times its turns by the audio stream, and a
          // response waits for audio to keep arriving.
          session.appendAudio(!$("ptt").checked || call?.talking ? audio : silence);
        },
        onLevel: (v) => ($("level").style.width = `${Math.round(v * 100)}%`),
      });
    } catch (err) {
      transcript.crumb(`No microphone (${err.message}). You can still type.`, null, "warn");
    }

    await session.connect({
      type: "realtime",
      output_modalities: ["text"],
      // Push to talk sends the caller's audio only while the button is held, and the server
      // answers a finished turn itself. See the talk button below.
      audio: { input: { format: format.format, turn_detection: { type: "server_vad", create_response: true } } },
      ...runner.sessionConfig(),
    });
    transcript.crumb(`Agent: ${runner.current.name}`, { instructions: runner.current.instructions, tools: runner.sessionConfig().tools.map((t) => t.name) }, "handoff");
    // The agent speaks first, as it would answering the phone.
    session.requestResponse();
    button.textContent = "Disconnect";
    button.classList.add("connected");
    $("text").disabled = false;
    $("composer").querySelector("button").disabled = false;
    $("talk").disabled = !$("ptt").checked;
    $("text").focus();
  } catch (err) {
    disconnect(`Couldn't connect: ${err.message}`);
  } finally {
    button.disabled = false;
  }
}

function disconnect(reason) {
  if (!call) return;
  const c = call;
  call = null;
  c.mic?.stop();
  c.voice?.stopAll();
  c.voice?.close?.();
  c.session.close();
  speaking = 0;
  if (reason) transcript.crumb(reason, null, "warn");
  setStatus("closed");
  $("connect").textContent = "Connect";
  $("connect").classList.remove("connected");
  $("text").disabled = true;
  $("composer").querySelector("button").disabled = true;
  $("talk").disabled = true;
  $("level").style.width = "0";
}

async function makeVoice(session) {
  const [kind, id] = $("voice").value.split(/:(.*)/s);
  const onSpeaking = ({ id: rid, speaking: on, heard, interrupted }) => {
    speaking = Math.max(0, speaking + (on ? 1 : -1));
    setStatus(session.state);
    if (interrupted) transcript.heard(rid, heard);
  };
  if (kind === "cartesia") {
    const voice = new CartesiaVoice({ session, voiceId: id, url: wsUrl("/tts"), onSpeaking });
    try {
      await voice.start();
      return voice;
    } catch (err) {
      transcript.crumb(`Cartesia unavailable (${err.message}). Using the browser's voice.`, null, "warn");
    }
  }
  const voice = new BrowserVoice({ session, voiceName: kind === "browser" ? id : undefined, onSpeaking });
  await voice.start();
  return voice;
}

function stopVoice() {
  call?.voice?.stopAll();
  call?.voice?.close?.();
  if (call) call.voice = null;
  speaking = 0;
}

function bind(session, runner) {
  const partial = new Map();
  session.on("input_audio_buffer.committed", (e) => transcript.user(e.item_id, "", { pending: true }));
  session.on("conversation.item.input_audio_transcription.delta", (e) => {
    partial.set(e.item_id, (partial.get(e.item_id) ?? "") + e.delta);
    transcript.user(e.item_id, partial.get(e.item_id));
  });
  session.on("conversation.item.input_audio_transcription.completed", (e) => transcript.user(e.item_id, e.transcript));

  session.on("agent.delta", ({ responseId, delta, text }) => {
    transcript.agentText(responseId, runner.current.name, text);
    call?.voice?.push(responseId, delta);
  });
  session.on("agent.done", ({ responseId }) => call?.voice?.finish(responseId));
  session.on("response.done", ({ response }) => {
    transcript.annotate(response);
    if (response.status !== "completed") call?.voice?.drop(response.id);
  });
  // Dialog-RSN-1 has confirmed the caller is really talking, not just saying "mm-hm":
  // stop the agent's voice now. The playback reports tell it what they heard.
  session.on("input_audio_buffer.speech_started", () => call?.voice?.stopAll());

  session.on("tool.call", ({ call: c }) => transcript.toolCall(c));
  session.on("tool.result", (r) => transcript.toolResult(r));
  session.on("error", (e) => transcript.crumb(`Error: ${e.error?.message ?? "unknown"}`, e.error, "error"));
  session.on("state", ({ state }) => setStatus(state));
  session.on("close", ({ code, reason }) => {
    if (call?.session === session) disconnect(`The connection closed (${code}${reason ? `: ${reason}` : ""})`);
  });

  runner.on("handoff", ({ from, to, reason }) => {
    transcript.crumb(`Handoff: ${from} → ${to}`, { reason, instructions: runner.current.instructions }, "handoff");
    agentName = to;
    fillPickers();
  });
  runner.on("breadcrumb", ({ title, data }) => transcript.crumb(title, data));
}

const STATUS = {
  closed: "Disconnected",
  connecting: "Connecting",
  listening: "Listening",
  user_speaking: "Caller speaking",
  thinking: "Thinking",
  responding: "Responding",
  speaking: "Agent speaking",
};

function setStatus(state) {
  const shown = call && speaking > 0 && state !== "user_speaking" && state !== "closed" ? "speaking" : state;
  $("status").dataset.state = shown;
  $("status").textContent = STATUS[shown] ?? shown;
}

function showEmpty() {
  transcript.clear();
  const first = allAgentSets[scenarioKey][0];
  const div = document.createElement("div");
  div.className = "empty";
  div.innerHTML = `<p><b></b></p><p></p><p>Press <b>Connect</b> and start talking, or type below. Use headphones, so the agent doesn't hear itself.</p>`;
  div.querySelector("b").textContent = labels[scenarioKey] ?? scenarioKey;
  div.querySelectorAll("p")[1].textContent = `Starts with ${first.name}: ${first.handoffDescription}`;
  $("transcript").append(div);
}

fillPickers();
showEmpty();
