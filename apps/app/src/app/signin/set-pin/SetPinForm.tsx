"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Icon } from "@esoqo/ui";
import { actionRequestPinCode, actionSetPin } from "../actions";

export function SetPinForm() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const msisdnFromUrl = searchParams.get("msisdn");

  // If msisdn is in URL (from registration), start at 'code' step and send OTP automatically
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [msisdn, setMsisdn] = useState("+254 7");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [otpSent, setOtpSent] = useState(false);
  const router = useRouter();

  // Handle client-side mounting
  useEffect(() => {
    setMounted(true);
    if (msisdnFromUrl) {
      setMsisdn(msisdnFromUrl);
      setStep("code");
    }
  }, [msisdnFromUrl]);

  // Auto-send OTP when coming from registration
  useEffect(() => {
    if (mounted && msisdnFromUrl && !otpSent && step === "code") {
      setOtpSent(true);
      startTransition(async () => {
        const result = await actionRequestPinCode({
          msisdn: msisdnFromUrl.replace(/\s+/g, ""),
        });
        if (!result.ok) {
          setError(result.error);
          // If OTP sending fails, go back to phone step
          setStep("phone");
        }
      });
    }
  }, [mounted, msisdnFromUrl, otpSent, step]);

  function requestCode() {
    setError(null);
    startTransition(async () => {
      const result = await actionRequestPinCode({
        msisdn: msisdn.replace(/\s+/g, ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep("code");
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionSetPin({
        msisdn: msisdn.replace(/\s+/g, ""),
        code,
        pin,
        pinConfirm,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(result.data.next as Route);
      router.refresh();
    });
  }

  // Prevent hydration mismatch by not rendering conditional content until mounted
  if (!mounted) {
    return (
      <div className="fld">
        <label className="lab" htmlFor="msisdn">
          <Icon name="phone" size={15} />
          Phone number
        </label>
        <input
          className="inp mono"
          id="msisdn"
          value="+254 7"
          inputMode="tel"
          placeholder="07XX XXX XXX"
          disabled
        />
      </div>
    );
  }

  if (step === "phone") {
    return (
      <>
        <div className="fld">
          <label className="lab" htmlFor="msisdn">
            <Icon name="phone" size={15} />
            Phone number
          </label>
          <input
            className="inp mono"
            id="msisdn"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            inputMode="tel"
            placeholder="07XX XXX XXX"
          />
          <p className="hint">
            The number your Esoqo account is registered under.
          </p>
        </div>
        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }}>
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          className="btn btn-p"
          style={{ width: "100%" }}
          disabled={pending || !msisdn.trim()}
          onClick={requestCode}
        >
          {pending ? "Sending…" : "Send code"} <Icon name="send" size={16} />
        </button>
      </>
    );
  }

  return (
    <>
      {msisdnFromUrl && (
        <div className="note n-blue" style={{ marginBottom: 16 }}>
          <Icon name="info" size={18} />
          <div>
            <p>
              We sent a code to <strong className="mono">{msisdn}</strong> to
              confirm it's you.
            </p>
          </div>
        </div>
      )}
      <div className="fld">
        <label className="lab" htmlFor="code">
          <Icon name="keypad" size={15} />
          Code
        </label>
        <input
          className="inp mono"
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
        />
        <p className="hint">It can take a minute to arrive.</p>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pin">
          <Icon name="lock" size={15} />
          New PIN
        </label>
        <input
          className="inp mono"
          id="pin"
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          inputMode="numeric"
          maxLength={6}
        />
        <p className="hint">
          Four to six digits — avoid 1234, 0000 or anything predictable.
        </p>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pinc">
          <Icon name="lock" size={15} />
          Confirm PIN
        </label>
        <input
          className="inp mono"
          id="pinc"
          type="password"
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value)}
          inputMode="numeric"
          maxLength={6}
        />
      </div>
      {error && (
        <div className="note n-red" style={{ marginBottom: 16 }}>
          <div>
            <p>{error}</p>
          </div>
        </div>
      )}
      <button
        type="button"
        className="btn btn-p"
        style={{ width: "100%" }}
        disabled={pending || !code.trim() || !pin.trim() || !pinConfirm.trim()}
        onClick={submit}
      >
        {pending ? "Setting PIN…" : "Set PIN & sign in"}{" "}
        <Icon name="check" size={16} />
      </button>
      {!msisdnFromUrl && (
        <button
          type="button"
          className="btn btn-o"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => {
            setStep("phone");
            setError(null);
          }}
        >
          Use a different number
        </button>
      )}
    </>
  );
}
