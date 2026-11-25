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
import { scenarios, defaultScenario, labels } from "./scenarios/index.js";

const $ = (id) => document.getElementById(id);
// Paths are relative to the page, so it also works behind a proxy that mounts it under a prefix.
const wsUrl = (path) => new URL(path, location.href).href.replace(/^http/, "ws");
const relay = () => new WebSocket(wsUrl("realtime"));

const server = await fetch("config").then((r) => r.json()).catch(() => ({ cartesia: false }));
const transcript = new Transcript($("transcript"));
const log = new EventLog($("events"), $("eventFilter"));
$("copyLog").addEventListener("click", async () => {
  const button = $("copyLog");
  try {
    await navigator.clipboard.writeText(log.text());
    button.textContent = "Copied";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => (button.textContent = "Copy log"), 1500);
});

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

// ---- Scenario picker --------------------------------------------------------------------

const params = new URLSearchParams(location.search);
let scenarioKey = scenarios[params.get("scenario")] ? params.get("scenario") : defaultScenario;

function fillPicker() {
  $("scenario").replaceChildren(...Object.keys(scenarios).map((k) => new Option(labels[k] ?? k, k)));
  $("scenario").value = scenarioKey;
  const url = new URL(location.href);
  url.searchParams.set("scenario", scenarioKey);
  url.searchParams.delete("agent");
  history.replaceState(null, "", url);
}

$("scenario").addEventListener("change", () => {
  scenarioKey = $("scenario").value;
  if (call) disconnect();
  fillPicker();
  showEmpty();
});

// ---- Toolbar ---------------------------------------------------------------------------

$("inputFormat").replaceChildren(...Object.entries(INPUT_FORMATS).map(([k, f]) => new Option(f.label, k)));
$("inputFormat").value = INPUT_FORMATS[prefs.inputFormat] ? prefs.inputFormat : "pcm16";
$("ptt").checked = Boolean(prefs.ptt);
$("voiceOn").checked = prefs.voiceOn ?? true;
$("logs").checked = prefs.logs ?? true;
document.querySelector("main").classList.toggle("no-logs", !$("logs").checked);

// "Agent's voice" speaks each agent in its own Cartesia voice; the rest override it.
function fillVoices() {
  const options = [new Option("Agent's voice", "agent")];
  if (server.cartesia) for (const v of CARTESIA_VOICES) options.push(new Option(`Cartesia: ${v.label}`, `cartesia:${v.id}`));
  for (const v of BrowserVoice.voices()) options.push(new Option(`Browser: ${v.name}`, `browser:${v.name}`));
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
  const runner = new AgentRunner({ agent: scenarios[scenarioKey], session });
  call = { session, runner, voice: null, mic: null, talking: false, ending: false, language: null };
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
    const config = runner.sessionConfig();
    transcript.crumb(
      `Agent: ${runner.agent.name}`,
      { instructions: config.instructions, welcome_message: config.poly_first_assistant_message, tools: config.tools.map((t) => t.name), knowledge: config.poly_knowledge?.map((k) => k.name) },
      "marker",
    );
    // No response.create: the server says the welcome message (poly_first_assistant_message)
    // as the first response, as soon as the session is ready.
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

/**
 * A terminal tool ended the call. Stop listening now, let the last line play, then hang up.
 */
function hangUp(lineId) {
  const c = call;
  c.ending = true;
  c.lastLine = lineId;
  c.mic?.stop();
  c.mic = null;
  // After this tick, once the session has sent the tool's output and the line into history.
  setTimeout(() => c.session.close(), 0);
  // In case the voice never reports the end of the line.
  setTimeout(() => call === c && disconnect("The agent ended the call"), 15_000);
}

async function makeVoice(session) {
  let [kind, id] = $("voice").value.split(/:(.*)/s);
  if (kind === "agent") [kind, id] = server.cartesia && call.runner.agent.voice ? ["cartesia", call.runner.agent.voice] : ["browser", ""];
  const onSpeaking = ({ id: rid, speaking: on, heard, interrupted }) => {
    speaking = Math.max(0, speaking + (on ? 1 : -1));
    setStatus(session.state);
    if (interrupted) transcript.heard(rid, heard);
    if (!on && call?.ending && rid === call.lastLine) disconnect("The agent ended the call");
  };
  if (kind === "cartesia") {
    const voice = new CartesiaVoice({ session, voiceId: id, url: wsUrl("tts"), onSpeaking });
    try {
      await voice.start();
      if (call.language) voice.setLanguage(call.language);
      return voice;
    } catch (err) {
      transcript.crumb(`Cartesia unavailable (${err.message}). Using the browser's voice.`, null, "warn");
    }
  }
  const voice = new BrowserVoice({ session, voiceName: kind === "browser" ? id : undefined, onSpeaking });
  await voice.start();
  if (call.language) voice.setLanguage(call.language);
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

  session.on("agent.delta", ({ responseId, delta, text, emotion }) => {
    transcript.agentText(responseId, runner.agent.name, text);
    const voice = call?.voice;
    // Cartesia reads a reply's opening tag as delivery, so it gets the tag back.
    const tagged = emotion && voice instanceof CartesiaVoice && !voice.has(responseId);
    voice?.push(responseId, tagged ? `[${emotion}] ${delta}` : delta);
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
    if (call?.session === session && !call.ending) disconnect(`The connection closed (${code}${reason ? `: ${reason}` : ""})`);
  });

  // The agent switched language (poly_response_language): the voice follows, "fr-FR" -> "fr".
  runner.on("session", ({ fields }) => {
    if (!fields.poly_response_language || !call) return;
    call.language = fields.poly_response_language.slice(0, 2).toLowerCase();
    call.voice?.setLanguage(call.language);
  });
  runner.on("breadcrumb", ({ title, data }) => transcript.crumb(title, data));
  runner.on("step", ({ from, to, prompt }) => transcript.crumb(to ? `Step: ${to}` : `Left step ${from}`, prompt ? { prompt: prompt.trim() } : null, "marker"));
  // A tool's fixed line: said word for word by the page, with no reply generated for it.
  let said = 0;
  runner.on("say", ({ utterance, hangup }) => {
    const id = `said_${++said}`;
    transcript.agentText(id, runner.agent.name, utterance);
    if (hangup) hangUp(id);
    call?.voice?.push(id, `${utterance} `);
    call?.voice?.finish(id);
    if (hangup && !call?.voice) disconnect("The agent ended the call");
  });
  // A terminal tool whose last line was the model's own (its poly_spoken argument): hang up
  // once that response has been heard.
  runner.on("hangup", ({ responseId }) => {
    hangUp(responseId);
    if (!call?.voice?.has(responseId)) disconnect("The agent ended the call");
  });
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
  const agent = scenarios[scenarioKey];
  const div = document.createElement("div");
  div.className = "empty";
  div.innerHTML = `<p><b></b></p><p></p><p>Press <b>Connect</b> and start talking, or type below. Use headphones, so the agent doesn't hear itself.</p>`;
  div.querySelector("b").textContent = labels[scenarioKey] ?? scenarioKey;
  div.querySelectorAll("p")[1].textContent = agent.description;
  $("transcript").append(div);
}

fillPicker();
showEmpty();
