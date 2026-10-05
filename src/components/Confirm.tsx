import type { ReactNode } from "react";

export function Confirm(props: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="card w-[28rem] max-w-[90vw] shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">{props.title}</h2>
        <div className="mb-4 text-sm text-slate-600 dark:text-slate-300">{props.children}</div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={props.onCancel}>Cancel</button>
          <button className={`btn ${props.danger ? "btn-danger" : "btn-primary"}`} disabled={props.confirmDisabled} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
