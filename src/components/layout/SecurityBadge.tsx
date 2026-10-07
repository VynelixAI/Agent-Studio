import { api, getStoredApiKey, setStoredApiKey, type SecurityPolicy } from "@/lib/api";
import { Shield } from "lucide-react";
import { useEffect, useState } from "react";

export function SecurityBadge() {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [apiKey, setApiKey] = useState(getStoredApiKey());

  useEffect(() => {
    void api
      .securityPolicy()
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, [open]);

  const residency = policy?.dataResidencyDefault;

  return (
    <div className="relative">
      <button
        type="button"
        title={
          residency
            ? `Security & compliance · residency ${residency}`
            : "Security & compliance (US + India)"
        }
        aria-label="Security and compliance"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md border border-navy-600 text-ink-300 transition hover:border-cyan-500/50 hover:text-cyan-500"
      >
        <Shield className="h-3.5 w-3.5" />
        {residency && (
          <span className="absolute -bottom-0.5 -right-0.5 rounded bg-navy-800 px-0.5 text-[7px] font-semibold uppercase leading-none text-cyan-500 ring-1 ring-navy-700">
            {residency}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-navy-600 bg-navy-900 p-3 shadow-xl">
          <div className="text-xs font-semibold text-ink-100">
            Security · US + India
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
            {policy?.disclaimer ??
              "Aligned to NIST/SOC2/CCPA and DPDP/CERT-In practices."}
          </p>

          {policy && (
            <ul className="mt-2 space-y-1 text-[10px] text-ink-300">
              <li>Residency default: {policy.dataResidencyDefault}</li>
              <li>
                Secrets: {policy.encryptionAtRest} · YAML {policy.secretsInYaml}
              </li>
              <li>
                Retention: audit {policy.auditRetentionDays}d · runs{" "}
                {policy.runRetentionDays}d
              </li>
              <li>
                Auth: {policy.authRequired ? "required" : "optional (dev)"}
                {policy.authConfigured ? " · keys configured" : ""}
              </li>
            </ul>
          )}

          <div className="mt-2 max-h-28 overflow-y-auto text-[10px] text-ink-400">
            {policy?.frameworks.map((f) => (
              <div key={f.id} className="mb-1">
                <span className="text-cyan-500">[{f.region}]</span> {f.title}
              </div>
            ))}
          </div>

          <label className="mt-2 block text-[10px] text-ink-400">
            API key (sent as X-API-Key)
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-navy-600 bg-navy-950 px-2 font-mono text-[11px] outline-none focus:border-cyan-500"
            placeholder="as_…"
          />
          <button
            type="button"
            className="btn-primary mt-2 h-8 w-full px-2 text-[11px]"
            onClick={() => {
              setStoredApiKey(apiKey.trim());
              setOpen(false);
            }}
          >
            Save key
          </button>
        </div>
      )}
    </div>
  );
}
