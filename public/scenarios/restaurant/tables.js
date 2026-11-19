/**
 * The restaurant's book, mocked. Answers are derived from the request rather than rolled, so
 * the same question gets the same answer twice, and a booking made earlier in the call takes
 * its table. Swap these two functions for your reservations system.
 */

const AREAS = ["main", "terrace", "bar"];
const CAPACITY = { main: 6, terrace: 3, bar: 2 }; // tables per 15-minute slot
const FIRST_SEATING = 17 * 60;
const LAST_SEATING = 21 * 60 + 45;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// FNV-1a over the text, scaled to [0, 1]: stable, so a slot's occupancy never moves.
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 0xffffffff;
}

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const dayName = (iso) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const partySize = (n) => Math.round(Number(n)) || 2;

/** The model says "Friday" as often as a date: resolve it against today. A bare weekday is the next one, never today. */
export function resolveDay(day, today) {
  const raw = String(day ?? "").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(`${today}T12:00:00Z`);
  if (raw === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
  const i = DAYS.indexOf(raw.replace(/^(next|this)\s+/, ""));
  if (i >= 0) d.setUTCDate(d.getUTCDate() + ((i - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function tablesFree(book, day, minutes, area) {
  const pressure = minutes >= 19 * 60 && minutes <= 20 * 60 + 30 ? 0.82 : 0.35; // prime time fills up
  const taken = Math.floor(hash(`${day}|${minutes}|${area}`) * CAPACITY[area] * pressure * 1.4 + 0.5);
  const held = book.filter((b) => b.day === day && toMinutes(b.time) === minutes && b.area === area).length;
  return Math.max(0, CAPACITY[area] - Math.min(CAPACITY[area], taken) - held);
}

function fits(book, day, minutes, area, party) {
  if (minutes < FIRST_SEATING || minutes > LAST_SEATING) return false;
  if (area === "bar" && party > 2) return false;
  if (area === "terrace" && party > 6) return false;
  return tablesFree(book, day, minutes, area) > 0;
}

/** Free areas at the asked time, or the nearest times either side. */
export function checkAvailability(book, args, today) {
  const party = partySize(args.party_size);
  const day = resolveDay(args.day, today);
  const wanted = toMinutes(args.time);
  if (wanted === null) return { error: "invalid_time", detail: "Ask the guest for a time, in hours and minutes." };
  if (party > 12) return { available: false, reason: "Parties over 12 go through the Maitre d', Ghislaine." };
  const areas = AREAS.includes(args.area) ? [args.area] : AREAS;
  const base = { day, day_of_week: dayName(day), party_size: party };
  const free = areas.filter((a) => fits(book, day, wanted, a, party));
  if (free.length) return { ...base, available: true, time: toTime(wanted), areas: free };
  // Offer the nearest open slots rather than leave the model to invent one.
  const alternatives = [];
  for (let step = 15; step <= 90 && alternatives.length < 3; step += 15) {
    for (const minutes of [wanted - step, wanted + step]) {
      const area = areas.find((a) => fits(book, day, minutes, a, party));
      if (area && alternatives.length < 3) alternatives.push({ time: toTime(minutes), area });
    }
  }
  return { ...base, available: false, requested: args.time, alternatives };
}

/** Write the booking, if the slot is still free. */
export function createBooking(book, args, today) {
  const party = partySize(args.party_size);
  const day = resolveDay(args.day, today);
  const minutes = toMinutes(args.time);
  if (!args.name) return { error: "missing_name", detail: "Ask the guest for a name first." };
  if (minutes === null) return { error: "invalid_time", detail: "Confirm the time with the guest." };
  const area = AREAS.includes(args.area) ? (fits(book, day, minutes, args.area, party) ? args.area : null) : AREAS.find((a) => fits(book, day, minutes, a, party));
  if (!area) return { error: "slot_gone", detail: "That slot has just gone. Offer the guest another time." };
  const booking = {
    reference: `ML-${4821 + book.length}`,
    name: args.name,
    day,
    day_of_week: dayName(day),
    time: toTime(minutes),
    party_size: party,
    area,
    notes: args.notes ?? "",
  };
  book.push(booking);
  return { booked: true, ...booking };
}
