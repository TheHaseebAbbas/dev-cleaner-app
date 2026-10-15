import { fmtBytes, type Settings } from "../api";
import { Toggle } from "../ui/primitives";

/**
 * The scheduled check as one switch: a weekly look while the app is open that speaks up only
 * after a complete scan finds more than the threshold that it has not mentioned before. It only
 * tells; nothing is removed. A schedule set to clean is left alone here and shown as such.
 */
export function ReminderToggle({ settings, onChange, compact }: { settings: Settings; onChange: (s: Settings) => void; compact?: boolean }) {
  const sc = settings.schedule;
  const min = sc.min_bytes || 5 * 1024 ** 3;
  const amount = min % 1024 ** 3 === 0 ? `${min / 1024 ** 3} GB` : fmtBytes(min);
  if (sc.enabled && sc.action === "clean") {
    return <p className="muted text-xs">Scheduled cleanup is on and moves Safe to clean items to the Trash every {sc.every_days === 1 ? "day" : `${sc.every_days} days`}. Change it in Settings → Cleaning.</p>;
  }
  const on = sc.enabled && sc.action === "remind";
  const set = (v: boolean) => onChange({ ...settings, schedule: v ? { ...sc, enabled: true, action: "remind", profile: "recommended" } : { ...sc, enabled: false } });
  if (compact) {
    return (
      <label className="muted flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" className="cb" checked={on} onChange={(e) => set(e.target.checked)} />
        Tell me when there's more than {amount} to clean
      </label>
    );
  }
  return <Toggle checked={on} onChange={set} label={`Tell me when there's more than ${amount} to clean`} description={`Checks your projects every ${sc.every_days === 1 ? "day" : `${sc.every_days} days`} while Dev Cleaner is open, and only says something after a complete scan finds new things to clean. Nothing is removed.`} />;
}
