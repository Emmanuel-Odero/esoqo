import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@esoqo/ui";
import { SetPinForm } from "./SetPinForm";

export const metadata: Metadata = { title: "Set your PIN" };

// Make this page dynamic since it uses searchParams
export const dynamic = "force-dynamic";

export default function SetPinPage() {
  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card">
        <p className="kicker">Your Esoqo record</p>
        <h1>Set your PIN</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          Choose a PIN to secure your account and sign in.
        </p>
        <div style={{ marginTop: 22 }}>
          <Suspense fallback={<div>Loading...</div>}>
            <SetPinForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
