import type { Metadata } from "next";
import { Icon } from "@esoqo/ui";
import { VerifyForm } from "./VerifyForm";

export const metadata: Metadata = {
  title: "Verify a receipt or certificate",
  description: "Check any Esoqo receipt or certificate. No account needed.",
};

/**
 * The page an institution uses BEFORE it becomes a customer, and the
 * page a shopper uses when they want to know what they actually paid.
 * No login, no call to the issuing office, four seconds.
 *
 * Two artifacts land here and they are not the same kind of claim, so
 * the copy below splits them rather than describing one and waving at
 * the other. A certificate is a third party's attestation that Esoqo
 * merely holds; a receipt is Esoqo's own record of money it moved. The
 * "what this proves" wording is the substantive difference — "Esoqo
 * issues none of these itself" is a trust signal on a certificate and
 * would be actively false on a receipt.
 */
export default function VerifyPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Verify</p>
          <h1>Check a receipt or certificate</h1>
          <p className="lead">
            Type the code from any Esoqo receipt or certificate. No account, no
            sign-in, no telephone call to the shop or the issuing office.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 700 }}>
          <VerifyForm />

          <h2 style={{ margin: "44px 0 16px" }}>Which code do you have?</h2>
          <p className="lead" style={{ margin: "0 0 22px", maxWidth: "none" }}>
            The two look nothing alike, so you can tell at a glance which one
            you&rsquo;re holding.
          </p>
          <div className="grid g2">
            {(
              [
                [
                  "print",
                  "g",
                  "Receipt code",
                  "RC2609298KX3FQ",
                  [
                    "Fourteen characters, no dashes, always beginning RC. Appears in the SMS we send when a payment confirms and on the slip the shop prints.",
                    "Shows the shop, date, what was bought and the total. If the purchase was refunded, it says so and by how much.",
                  ],
                ],
                [
                  "certificate",
                  "b",
                  "Certificate code",
                  "0000-AAA-0000",
                  [
                    "Dashes and letters, bottom left of every printed certificate. On a phone, scan the QR code instead.",
                    "Shows the holder, the issuing body, the date, and whether it is in force or has expired or been revoked.",
                  ],
                ],
              ] as const
            ).map(([icon, tone, title, shape, paras]) => (
              <div className="card" key={title}>
                <span
                  className={`icbox icbox-${tone}`}
                  style={{ marginBottom: 14 }}
                >
                  <Icon name={icon} size={20} />
                </span>
                <h3 style={{ marginBottom: 8 }}>{title}</h3>
                <p
                  className="mono"
                  style={{
                    margin: "0 0 12px",
                    fontSize: ".88rem",
                    color: "var(--tx-2)",
                  }}
                >
                  {shape}
                </p>
                {paras.map((p, i) => (
                  <p
                    className="sub"
                    key={i}
                    style={{ fontSize: ".91rem", margin: "0 0 8px" }}
                  >
                    {p}
                  </p>
                ))}
              </div>
            ))}
          </div>

          <div
            className="card"
            style={{
              marginTop: 22,
              borderColor: "var(--red-t)",
              background: "rgba(255,111,98,.04)",
            }}
          >
            <div className="shead" style={{ marginBottom: 16 }}>
              <span className="icbox icbox-r">
                <Icon name="alert-circle" size={20} />
              </span>
              <div>
                <h3 style={{ marginBottom: 2 }}>If a check fails</h3>
              </div>
            </div>
            <p
              className="sub"
              style={{ fontSize: ".91rem", margin: "0 0 12px" }}
            >
              Codes are case-insensitive and the last character is a check
              digit, so a single mistyped or transposed character is usually
              caught before anything is looked up. Check it against the original
              — on a receipt, the printed slip; on a certificate, the document.
            </p>
            <p className="sub" style={{ fontSize: ".91rem", margin: 0 }}>
              If a carefully read code still fails, it was not issued through
              Esoqo. Report a suspected forgery to{" "}
              <a
                href="mailto:verify@esoqo.co.ke"
                style={{ color: "var(--red)", fontWeight: 600 }}
              >
                verify@esoqo.co.ke
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
