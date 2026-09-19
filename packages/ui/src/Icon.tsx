import type { SVGProps } from 'react';

/**
 * Icon system — 69 stroke icons on a 24px grid.
 *
 * No emoji anywhere in this product. Emoji render differently on every
 * platform, are announced unpredictably by screen readers, and cannot be
 * recoloured. Icons are decorative by default (aria-hidden); text always
 * carries the meaning.
 */

export type IconName = 'alert-circle' | 'alert-triangle' | 'arrow-left' | 'arrow-right' | 'ban' | 'bank' | 'basket' | 'box' | 'building' | 'calendar' | 'certificate' | 'chart' | 'check' | 'check-circle' | 'chevron-down' | 'chevron-right' | 'clock' | 'close' | 'coins' | 'cow' | 'document' | 'download' | 'eye' | 'filter' | 'gov' | 'grid' | 'handshake' | 'inbox' | 'info' | 'key' | 'keypad' | 'leaf' | 'link' | 'loader' | 'lock' | 'mail' | 'map' | 'menu' | 'message' | 'package' | 'phone' | 'phone-call' | 'pin' | 'play-circle' | 'plug' | 'plus' | 'plus-circle' | 'print' | 'qr' | 'refresh' | 'scales' | 'seal' | 'search' | 'send' | 'shield' | 'shield-check' | 'shop' | 'sort' | 'star' | 'tag' | 'trend-down' | 'trend-flat' | 'trend-up' | 'truck' | 'umbrella' | 'user' | 'users' | 'wheat' | 'wifi-off';

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} aria-hidden="true" focusable="false" className="ic" {...rest}>
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Rendered once in the root layout. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
      <symbol id="i-alert-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M12 8v5M12 16v.01'/></symbol>
      <symbol id="i-alert-triangle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 4L2.5 20h19z'/><path d='M12 10v4M12 17.5v.01'/></symbol>
      <symbol id="i-arrow-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M20 12H4M10 18l-6-6 6-6'/></symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M4 12h16M14 6l6 6-6 6'/></symbol>
      <symbol id="i-ban" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M5.6 5.6l12.8 12.8'/></symbol>
      <symbol id="i-bank" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3 10h18M4.5 10v8M9 10v8M15 10v8M19.5 10v8M2.5 20.5h19'/><path d='M12 2.5L21 8H3z'/></symbol>
      <symbol id="i-basket" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M4 9h16l-1.6 10.5a2 2 0 01-2 1.5H7.6a2 2 0 01-2-1.5z'/><path d='M8.5 9L11 3M15.5 9L13 3M9 13v4M15 13v4'/></symbol>
      <symbol id="i-box" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M21 8.5v7a2 2 0 01-1 1.7l-7 4a2 2 0 01-2 0l-7-4a2 2 0 01-1-1.7v-7a2 2 0 011-1.7l7-4a2 2 0 012 0l7 4a2 2 0 011 1.7z'/><path d='M3.3 7.5L12 12.5l8.7-5M12 12.5V21'/></symbol>
      <symbol id="i-building" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='4' y='3' width='16' height='18' rx='1.5'/><path d='M8.5 7.5h.01M12 7.5h.01M15.5 7.5h.01M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M10 21v-5h4v5'/></symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='3.5' y='5' width='17' height='16' rx='2'/><path d='M3.5 10h17M8 3v4M16 3v4'/></symbol>
      <symbol id="i-certificate" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='3' y='3.5' width='18' height='13' rx='1.5'/><path d='M7 8h7M7 11.5h5'/><circle cx='17' cy='17.5' r='3.5'/><path d='M15 20.5v3l2-1.2 2 1.2v-3'/></symbol>
      <symbol id="i-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3.5 20.5h17'/><path d='M6 17V11M11 17V6M16 17v-8'/></symbol>
      <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M4 12.5l5 5L20 6.5'/></symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M8 12.5l2.5 2.5L16 9.5'/></symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M6 9l6 6 6-6'/></symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M9 6l6 6-6 6'/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3.5 2'/></symbol>
      <symbol id="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M6 6l12 12M18 6L6 18'/></symbol>
      <symbol id="i-coins" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><ellipse cx='9' cy='6.5' rx='6' ry='3'/><path d='M3 6.5v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4'/><path d='M15 11c3 .3 6 1.5 6 3v4c0 1.7-2.7 3-6 3s-6-1.3-6-3v-1.2'/></symbol>
      <symbol id="i-cow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M5 8.5C5 6 6.5 4.5 8 4.5l1.5 2h5L16 4.5c1.5 0 3 1.5 3 4v3c0 4-3 6.5-7 6.5S5 15.5 5 11.5z'/><path d='M9.5 10.5h.01M14.5 10.5h.01M10 14.5h4'/><path d='M7 19.5v2M17 19.5v2'/></symbol>
      <symbol id="i-document" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M14 2.5H7A1.5 1.5 0 005.5 4v16A1.5 1.5 0 007 21.5h10a1.5 1.5 0 001.5-1.5V7z'/><path d='M14 2.5V7h4.5'/><path d='M9 12h6M9 16h6'/></symbol>
      <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 3v12M7 11l5 5 5-5'/><path d='M4 20h16'/></symbol>
      <symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z'/><circle cx='12' cy='12' r='2.8'/></symbol>
      <symbol id="i-filter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3 5h18l-7 8v6l-4 2v-8z'/></symbol>
      <symbol id="i-gov" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 2.5l8.5 4.5H3.5z'/><path d='M6 9.5v8M10 9.5v8M14 9.5v8M18 9.5v8M3.5 20.5h17'/></symbol>
      <symbol id="i-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='3.5' y='3.5' width='7' height='7' rx='1'/><rect x='13.5' y='3.5' width='7' height='7' rx='1'/><rect x='3.5' y='13.5' width='7' height='7' rx='1'/><rect x='13.5' y='13.5' width='7' height='7' rx='1'/></symbol>
      <symbol id="i-handshake" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M8 12l-3-3 4-4 3 2 3-2 4 4-3 3'/><path d='M11 15l2 2 2-2 2 2'/><path d='M5 9l-2.5 2.5L7 16'/><path d='M19 9l2.5 2.5L17 16'/></symbol>
      <symbol id="i-inbox" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M22 12h-6l-2 3h-4l-2-3H2'/><path d='M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z'/></symbol>
      <symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8v.01'/></symbol>
      <symbol id="i-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='7.5' cy='15.5' r='4'/><path d='M10.5 12.5L20 3M17 6l2.5 2.5M14.5 8.5L17 11'/></symbol>
      <symbol id="i-keypad" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8.5 8h.01M12 8h.01M15.5 8h.01M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01'/></symbol>
      <symbol id="i-leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M4 20C3 12 8 4 20 4c0 12-8 17-16 16z'/><path d='M4 20c3-6 7-9 12-11'/></symbol>
      <symbol id="i-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7'/><path d='M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7'/></symbol>
      <symbol id="i-loader" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9'/></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='4.5' y='10' width='15' height='11' rx='2'/><path d='M8 10V7a4 4 0 018 0v3'/><path d='M12 14.5v2.5'/></symbol>
      <symbol id="i-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='2.5' y='5' width='19' height='14' rx='2'/><path d='M3 7l9 6 9-6'/></symbol>
      <symbol id="i-map" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M2.5 6.5l6-3 7 3 6-3v14l-6 3-7-3-6 3z'/><path d='M8.5 3.5v14M15.5 6.5v14'/></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3 6h18M3 12h18M3 18h18'/></symbol>
      <symbol id="i-message" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M20 4H4a1.5 1.5 0 00-1.5 1.5v9A1.5 1.5 0 004 16h3v4l5-4h8a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0020 4z'/></symbol>
      <symbol id="i-package" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M16.5 9.4L7.6 4.2'/><path d='M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4a2 2 0 002-1.7z'/><path d='M3.3 7L12 12l8.7-5M12 12v9'/></symbol>
      <symbol id="i-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='6' y='2.5' width='12' height='19' rx='2.5'/><path d='M10.5 18.5h3'/></symbol>
      <symbol id="i-phone-call" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M4.5 4.5h4l2 5-2.5 1.5a11 11 0 005 5L14.5 13.5l5 2v4a1.5 1.5 0 01-1.7 1.5A16 16 0 013 6.2 1.5 1.5 0 014.5 4.5z'/></symbol>
      <symbol id="i-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 21.5s7-6.2 7-11.3A7 7 0 105 10.2c0 5.1 7 11.3 7 11.3z'/><circle cx='12' cy='10' r='2.6'/></symbol>
      <symbol id="i-play-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M10 8.5l6 3.5-6 3.5z'/></symbol>
      <symbol id="i-plug" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M9 3v6M15 3v6'/><path d='M6.5 9h11v3a5.5 5.5 0 01-11 0z'/><path d='M12 17.5V22'/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 5v14M5 12h14'/></symbol>
      <symbol id="i-plus-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='12' r='9'/><path d='M12 8v8M8 12h8'/></symbol>
      <symbol id="i-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M7 9V3.5h10V9'/><rect x='3.5' y='9' width='17' height='7' rx='1.5'/><path d='M7 14h10v6.5H7z'/></symbol>
      <symbol id="i-qr" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><path d='M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4'/></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M20 11a8 8 0 10-1.6 5.5'/><path d='M20 5v6h-6'/></symbol>
      <symbol id="i-scales" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 3v18M7 21h10M3 8l4-3 4 3M3 8l2 5h-4zM13 8l4-3 4 3M13 8l2 5h-4z'/></symbol>
      <symbol id="i-seal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='10' r='6.5'/><path d='M9 15.5V22l3-1.7 3 1.7v-6.5'/><path d='M9.5 10l1.8 1.8L15 8'/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='11' cy='11' r='7'/><path d='M20 20l-3.5-3.5'/></symbol>
      <symbol id="i-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M21 3L3 10.5l7 3 3 7z'/><path d='M10 13.5L21 3'/></symbol>
      <symbol id="i-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 2.5l8 3v6c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10v-6z'/></symbol>
      <symbol id="i-shield-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 2.5l8 3v6c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10v-6z'/><path d='M9 11.5l2.2 2.2L15.5 9.5'/></symbol>
      <symbol id="i-shop" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3.5 9.5V20h17V9.5'/><path d='M2.5 9.5L4.5 4h15l2 5.5a3 3 0 01-5.5 1.7 3 3 0 01-5 0 3 3 0 01-5.5-1.7z'/><path d='M9.5 20v-5.5h5V20'/></symbol>
      <symbol id="i-sort" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3'/></symbol>
      <symbol id="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.3L12 17.2 6.4 20.2l1.2-6.3L3 9.6l6.3-.8z'/></symbol>
      <symbol id="i-tag" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M20.5 12.8l-7.7 7.7a2 2 0 01-2.8 0l-7-7a2 2 0 01-.6-1.6l.5-6.4a2 2 0 011.9-1.9l6.4-.5a2 2 0 011.6.6l7 7a2 2 0 01.7 2.1z'/><circle cx='8.5' cy='8.5' r='1.6'/></symbol>
      <symbol id="i-trend-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3 7l6 6 4-4 8 8'/><path d='M15 17h6v-6'/></symbol>
      <symbol id="i-trend-flat" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M4 12h16'/></symbol>
      <symbol id="i-trend-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3 17l6-6 4 4 8-8'/><path d='M15 7h6v6'/></symbol>
      <symbol id="i-truck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M2.5 6.5h11v10h-11z'/><path d='M13.5 10h4l3 3.2v3.3h-7z'/><circle cx='7' cy='18.5' r='2'/><circle cx='17' cy='18.5' r='2'/></symbol>
      <symbol id="i-umbrella" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 2.5v2M2.5 12a9.5 9.5 0 0119 0z'/><path d='M12 12v7a2.5 2.5 0 005 0'/></symbol>
      <symbol id="i-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='12' cy='8' r='3.5'/><path d='M4.5 20a7.5 7.5 0 0115 0'/></symbol>
      <symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx='9' cy='8' r='3.2'/><path d='M2.5 19.5a6.5 6.5 0 0113 0'/><path d='M16 5.2a3.2 3.2 0 010 5.6M17.5 19.5a6.6 6.6 0 00-2-4.7'/></symbol>
      <symbol id="i-wheat" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M12 21V9'/><path d='M12 9c0-2.5 2-4.5 2-4.5s2 2 2 4.5-2 4.5-2 4.5-2-2-2-4.5z'/><path d='M12 13c-2.5 0-4.5-2-4.5-2s2-2 4.5-2M12 13c2.5 0 4.5-2 4.5-2s-2-2-4.5-2M12 18c-2.5 0-4.5-2-4.5-2s2-2 4.5-2M12 18c2.5 0 4.5-2 4.5-2s-2-2-4.5-2'/></symbol>
      <symbol id="i-wifi-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d='M3 8a15 15 0 0118 0M6.5 11.5a10 10 0 0111 0M9.5 15a5 5 0 015 0M12 19v.01'/></symbol>
      </defs>
    </svg>
  );
}
