-- Platform client management: per-client seat (user/card) allowance set by
-- OpenCard staff. NULL = use the plan's card limit; -1 = unlimited (per-seat
-- billing); else a hard cap.
ALTER TABLE "Org" ADD COLUMN "seatLimit" INTEGER;
