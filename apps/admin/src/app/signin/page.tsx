import type { Metadata } from "next";
import { SignInForm } from "./SignInForm";
import { Logo } from "@esoqo/ui";
import "./signin.css";

export const metadata: Metadata = { title: "Staff sign-in" };

export default function SignInPage() {
  return (
    <div className="si-root">
      <div className="si-brand">
        <div className="si-brand-inner">
          <span className="si-mark">
            <Logo />
          </span>
          <strong>Esoqo</strong>
          <span className="si-brand-sub">Operations Dashboard</span>
        </div>
        <div className="si-brand-foot">
          <span className="si-badge">Staff access only</span>
        </div>
      </div>
      <div className="si-panel">
        <div className="si-card">
          <div className="si-card-hd">
            <h1>Welcome back</h1>
            <p>Sign in with the PIN your administrator gave you.</p>
          </div>
          <SignInForm />
          <p className="si-footnote">
            Protected by the Esoqo security framework.
          </p>
        </div>
      </div>
    </div>
  );
}
