"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Xiaomi MiMo Auth Modal
 *
 * Dual auth, three paths:
 *   1. Auto-import the local MiMo Desktop account passToken (one-click).
 *   2. Paste an sk- API key (cloud API only — Preview models need the session).
 *   3. Browser sign-in via the custom ECDH encrypted-callback flow.
 *
 * The passToken is what unlocks the Desktop-exclusive Preview models and the
 * weekly quota; an API key alone cannot reach those endpoints.
 */
export default function XiaomiMimoAuthModal({ isOpen, onSuccess, onClose }) {
  // detect | found | not-found
  const [phase, setPhase] = useState("detect");
  const [detectResult, setDetectResult] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // null until a browser flow starts
  const [oauthUrl, setOauthUrl] = useState(null);
  const [oauthState, setOauthState] = useState(null);

  const runAutoDetect = useCallback(async () => {
    setPhase("detect");
    setError(null);
    setDetectResult(null);
    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/auto-import");
      const data = await res.json();
      if (data.found) {
        setDetectResult(data);
        setPhase("found");
      } else {
        setPhase("not-found");
        setError(data.error || "MiMo Desktop account not found.");
      }
    } catch {
      setPhase("not-found");
      setError("Failed to detect MiMo Desktop.");
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setOauthUrl(null);
    setOauthState(null);
    setApiKey("");
    runAutoDetect();
  }, [isOpen, runAutoDetect]);

  const handleImportDesktop = async () => {
    setBusy(true);
    setError(null);
    try {
      // Desktop-only import: persist the detected passToken as the credential.
      const res = await fetch("/api/oauth/xiaomi-mimo/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desktopLinked: true, passToken: detectResult?.passToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleApiKey = async () => {
    if (!apiKey.trim()) {
      setError("Enter an API key (sk-...)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartOAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/authorize");
      const data = await res.json();
      if (!res.ok || !data.authorizeUrl) throw new Error(data.error || "Could not start sign-in");
      setOauthUrl(data.authorizeUrl);
      setOauthState(data.state);
      window.open(data.authorizeUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePollOAuth = async () => {
    if (!oauthState) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/oauth/xiaomi-mimo/poll-status?state=${encodeURIComponent(oauthState)}`);
      const data = await res.json();
      if (data.status === "done") {
        const ex = await fetch("/api/oauth/xiaomi-mimo/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: oauthState }),
        });
        const exData = await ex.json();
        if (!ex.ok) throw new Error(exData.error || "Exchange failed");
        onSuccess?.();
        onClose();
      } else if (data.status === "error") {
        setError(data.error || "Sign-in failed");
        setOauthUrl(null);
      } else {
        setError("Still waiting — complete the sign-in in your browser, then click Check Again.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Xiaomi MiMo" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {phase === "detect" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Detecting MiMo Desktop...</h3>
            <p className="text-sm text-text-muted">Reading the local Xiaomi account cookie store</p>
          </div>
        )}

        {phase !== "detect" && (
          <>
            {phase === "found" && detectResult && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-20 dark:border-green-800 flex flex-col gap-2">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    MiMo Desktop account detected{detectResult.userId ? ` (uid ${detectResult.userId})` : ""}.
                    Importing unlocks the Preview models and weekly quota.
                  </p>
                </div>
                <Button onClick={handleImportDesktop} fullWidth disabled={busy}>
                  {busy ? "Importing..." : "Import Desktop Session"}
                </Button>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {!oauthUrl ? (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    API Key <span className="text-text-muted">(optional — cloud models only)</span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  {phase === "not-found" && (
                    <Button onClick={runAutoDetect} variant="outline" fullWidth>
                      Retry Detect
                    </Button>
                  )}
                  {apiKey.trim() ? (
                    <Button onClick={handleApiKey} fullWidth disabled={busy}>
                      {busy ? "Connecting..." : "Connect API Key"}
                    </Button>
                  ) : (
                    <Button onClick={handleStartOAuth} fullWidth disabled={busy}>
                      {busy ? "Starting..." : "Sign in via Browser"}
                    </Button>
                  )}
                  <Button onClick={onClose} variant="ghost" fullWidth>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Browser opened. Complete the Xiaomi sign-in, then click <strong>Check Again</strong>.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handlePollOAuth} fullWidth disabled={busy}>
                    {busy ? "Checking..." : "Check Again"}
                  </Button>
                  <Button onClick={onClose} variant="ghost" fullWidth>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

XiaomiMimoAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
