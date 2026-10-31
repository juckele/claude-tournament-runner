// Plans and upgrade prompts. On Android, purchases happen on the website (store billing rules),
// so the app explains the limit and links nowhere to pay.
import { Link } from "react-router-dom";
import { api, ApiError, PlanLimitBody, PlanName, PUBLIC_ORIGIN, Tournament } from "./api";
import { useAction } from "./hooks";
import { isNative } from "./native";
import { Button, Dialog } from "./ui";

export const planLabel: Record<PlanName, string> = { free: "Free", club: "Club plan", event_pass: "Event pass", unlimited: "Everything included" };

/** Is this error a plan limit? Returns its body so the caller can show the upgrade dialog. */
export const planLimitOf = (e: unknown): PlanLimitBody | null =>
  e instanceof ApiError && e.code === "plan_limit" ? ({ ...e.body, detail: e.detail } as PlanLimitBody) : null;

const WHAT: Record<string, string> = {
  max_players: "Free tournaments have up to 24 players.",
  max_running: "On the free plan, one tournament runs at a time.",
  max_directors: "Free tournaments have up to two directors, the owner included.",
  auto_advance: "Pairing rounds automatically is part of the Club plan and event passes.",
  sms: "Text messages are part of the Club plan and event passes.",
};
export const limitText = (limit: string) => WHAT[limit] ?? "That's beyond the free plan.";

/** Start checkout and leave for Stripe (in development the plan switches on and we come straight back). */
export async function goToCheckout(path: string, body?: unknown) {
  const r = await api<{ url: string }>("POST", path, body ?? {});
  location.assign(r.url);
}

export function UpgradeOptions({ t, clubId, compact }: { t?: Tournament; clubId?: string | null; compact?: boolean }) {
  const { busy, run } = useAction();
  if (isNative)
    return <p className="small muted">Plans are managed on the website, at {PUBLIC_ORIGIN.replace(/^https?:\/\//, "")}.</p>;
  const club = clubId ?? t?.club?.id ?? null;
  return (
    <div className={compact ? "row" : "stack"}>
      {club ? (
        <Link className="btn btn-primary" to={`/clubs/${club}`}>Get the Club plan, $10 a month</Link>
      ) : (
        <Link className="btn btn-primary" to="/clubs">Run it in a club with the Club plan</Link>
      )}
      {t ? (
        <Button busy={busy} onClick={() => run(() => goToCheckout(`/tournaments/${t.id}/event-pass`))}>Buy an event pass for this tournament</Button>
      ) : null}
    </div>
  );
}

export function PlanLimitDialog({ limit, t, onClose }: { limit: PlanLimitBody | null; t?: Tournament; onClose: () => void }) {
  return (
    <Dialog open={!!limit} onClose={onClose} title="That needs a paid plan">
      {limit ? (
        <div className="stack">
          <p>{limitText(limit.limit)}{limit.have != null && limit.limit === "max_players" ? ` This one has ${limit.have}.` : ""}</p>
          <p className="small muted">
            The Club plan lifts the limits for every tournament your club runs. An event pass lifts them for one tournament.
            {limit.upgrade?.club_id ? "" : " To use the Club plan, move this tournament into a club in its settings."}
          </p>
          <UpgradeOptions t={t} clubId={limit.upgrade?.club_id} />
        </div>
      ) : null}
    </Dialog>
  );
}

/** Inline explanation next to a control the plan doesn't include. */
export function NeedsPlan({ feature, t }: { feature: "auto_advance" | "sms"; t: Tournament }) {
  if (!t.plan?.billing || t.plan.limits[feature]) return null;
  return (
    <div className="note note-info small stack" style={{ gap: 8 }}>
      <span>{limitText(feature)}</span>
      <UpgradeOptions t={t} compact />
    </div>
  );
}
