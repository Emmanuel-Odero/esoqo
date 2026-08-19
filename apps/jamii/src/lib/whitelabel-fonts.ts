import { Big_Shoulders, Lexend, IBM_Plex_Mono } from 'next/font/google';

/**
 * The three typefaces from the provided template — applied only to
 * custom-domain pages via the CSS variables jamii.css's .wl-theme
 * already expects (--font-display/--font-body/--font-mono), never
 * globally, so the primary domain's own system-ui look is untouched.
 * See WhitelabelThemeRoot, the one place these variable classes land.
 */
export const wlDisplayFont = Big_Shoulders({
  subsets: ['latin'], weight: ['600', '700', '800', '900'], variable: '--font-display', display: 'swap',
});
export const wlBodyFont = Lexend({
  subsets: ['latin'], weight: ['300', '400', '500', '600', '700'], variable: '--font-body', display: 'swap',
});
export const wlMonoFont = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap',
});

export const wlFontVariables = `${wlDisplayFont.variable} ${wlBodyFont.variable} ${wlMonoFont.variable}`;
