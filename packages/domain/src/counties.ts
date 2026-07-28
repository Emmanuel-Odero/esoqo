/** All 47. The first eight have field officers and daily prices. */
export const COUNTIES = [
  'Nairobi', 'Turkana', 'Elgeyo Marakwet', 'West Pokot', 'Uasin Gishu',
  'Kiambu', 'Nakuru', 'Trans Nzoia',
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Embu', 'Garissa', 'Homa Bay',
  'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kilifi', 'Kirinyaga',
  'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos',
  'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa',
  "Murang'a", 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri',
  'Samburu', 'Siaya', 'Taita Taveta', 'Tana River', 'Tharaka Nithi',
  'Vihiga', 'Wajir',
] as const;

export const LIVE_COUNTIES = COUNTIES.slice(0, 8);
export type County = (typeof COUNTIES)[number];
