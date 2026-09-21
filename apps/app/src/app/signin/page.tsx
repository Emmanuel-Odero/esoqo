import type { Metadata } from "next";
import { Icon, Logo } from "@esoqo/ui";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function SignIn() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
        background: "var(--paper)",
      }}
    >
      {/* Centered logo with clean spacing */}
      <div
        style={{
          marginBottom: 32,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Logo />
      </div>

      {/* Sign in card - centered */}
      <div
        className="auth-card"
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-xl)",
          padding: "32px 28px",
          boxShadow: "var(--sh-s)",
          textAlign: "center",
        }}
      >
        <p
          className="kicker"
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--green)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          Welcome back
        </p>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            margin: "8px 0 0",
            color: "var(--navy)",
          }}
        >
          Sign in
        </h1>
        <p
          className="lead"
          style={{
            marginTop: 8,
            fontSize: "0.95rem",
            color: "var(--tx-2)",
            lineHeight: 1.5,
          }}
        >
          Use your phone number or email, and your PIN to continue.
        </p>

        <div style={{ marginTop: 28 }}>
          <SignInForm />
        </div>
      </div>

      {/* Alternative access section */}
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          marginTop: 20,
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          padding: "18px 20px",
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--r-sm)",
            background: "var(--green-t)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="keypad" size={20} style={{ color: "var(--green)" }} />
        </div>
        <div>
          <h2
            style={{
              fontSize: "1rem",
              fontWeight: 700,
              margin: "2px 0 4px",
              color: "var(--navy)",
            }}
          >
            No smartphone with you?
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--tx-2)", margin: 0 }}>
            Dial{" "}
            <strong className="mono" style={{ color: "var(--navy)" }}>
              *483*77#
            </strong>
            . Everything here works from a basic handset.
          </p>
        </div>
      </div>
    </div>
  );
}
