export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`lock${inverse ? " inv" : ""}`}>
      <img
        src={inverse ? "/esoko-logo-dark.png" : "/esoko-logo-light.png"}
        alt="Esoqo home"
        style={{ height: "60px", width: "auto", display: "block" }}
      />
      <span className="sr-only">Esoqo home</span>
    </span>
  );
}
