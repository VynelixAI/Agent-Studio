import { openFixChat } from "@/components/dialogs/FlightCheck";
import { useStudioStore } from "@/store/studioStore";
import { Database, LayoutTemplate, MessageSquare, X } from "lucide-react";
import { useState } from "react";

/** After a test, offer the two saves that already exist: MongoDB and a template. */
export function AfterRunOffer() {
  const offer = useStudioStore((s) => s.postRunOffer);
  const dismiss = useStudioStore((s) => s.dismissPostRunOffer);
  const apply = useStudioStore((s) => s.requestApplyToBackend);
  const convert = useStudioStore((s) => s.convertCurrentToTemplate);
  const name = useStudioStore((s) => s.document.workspace.name);
  const [templateName, setTemplateName] = useState("");
  const [showName, setShowName] = useState(false);
  if (!offer) return null;

  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 z-30 w-[min(100%,28rem)] -translate-x-1/2 px-3">
      <div className="pointer-events-auto rounded-xl border border-cyan-500/40 bg-navy-900/95 p-3 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-ink-100">
              Test {offer.status}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-400">
              Nothing is saved yet. Save to the database or convert to a template when you want. You can close this and do it later.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-ink-400 hover:text-ink-100"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {showName && (
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={`${name} template`}
            className="mt-2 w-full rounded-md border border-navy-600 bg-navy-950 px-2 py-1.5 text-[12px] outline-none focus:border-cyan-500"
          />
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px]"
            onClick={() => apply()}
          >
            <Database className="h-3.5 w-3.5" />
            Save to database
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-navy-600 px-3 py-1.5 text-[11px] text-ink-100 hover:border-cyan-500"
            onClick={() =>
              openFixChat(
                offer.status === "succeeded"
                  ? "The last run finished. What should I tighten before the next run?"
                  : "The last run failed. Tell me the mandatory options that are empty and a fix I can apply.",
              )
            }
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Fix in chat
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-navy-600 px-3 py-1.5 text-[11px] text-ink-100 hover:border-cyan-500"
            onClick={() => {
              if (!showName) {
                setShowName(true);
                setTemplateName(`${name} template`);
                return;
              }
              convert({
                name: templateName.trim() || `${name} template`,
                description: `Saved after test ${offer.runId}`,
              });
              dismiss();
            }}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            {showName ? "Save template" : "Convert to template"}
          </button>
        </div>
      </div>
    </div>
  );
}
