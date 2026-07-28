/**
 * Screen readers announce "KES 4,650" as "K E S four comma six five zero".
 * That is unusable for money. These produce a spelled form to sit beside
 * the visual figure inside <VisuallyHidden>.
 */
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
  'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

function under1000(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]!;
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  return n % 100 ? `${h} and ${under1000(n % 100)}` : h;
}

export function spellMoney(amount: number, currency = 'shillings'): string {
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return `zero ${currency}`;
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions) parts.push(`${under1000(millions)} million`);
  if (thousands) parts.push(`${under1000(thousands)} thousand`);
  if (rest) parts.push(under1000(rest));
  const sign = amount < 0 ? 'minus ' : '';
  return `${sign}${parts.join(' ')} ${currency}`;
}

export function spellDate(d: Date): string {
  return d.toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
