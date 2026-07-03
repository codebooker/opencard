// Pure event helpers — no db. Live/status determination from an event's active
// flag + optional start/end window. Unit-tested.

type EventLike = { active?: boolean | null; startsAt?: Date | string | null; endsAt?: Date | string | null };

export type EventStatus = "off" | "upcoming" | "live" | "ended";

export function eventStatus(ev: EventLike, now: Date = new Date()): EventStatus {
  if (ev.active === false) return "off";
  const t = now.getTime();
  if (ev.startsAt && t < new Date(ev.startsAt).getTime()) return "upcoming";
  if (ev.endsAt && t > new Date(ev.endsAt).getTime()) return "ended";
  return "live";
}

// A QR asset tied to an event only resolves while the event is live.
export function eventLive(ev: EventLike, now: Date = new Date()): boolean {
  return eventStatus(ev, now) === "live";
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  off: "Off",
  upcoming: "Upcoming",
  live: "Live",
  ended: "Ended",
};
