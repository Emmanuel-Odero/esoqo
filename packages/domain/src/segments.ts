/**
 * Segment dictionary — 92 kinds of work, 595 searchable aliases in
 * English, Kiswahili and Sheng.
 *
 * This exists because of a specific, observed adoption failure: in Kenya,
 * if a platform does not name your trade, you assume it is not for you.
 * A carpenter who does not see "carpentry" leaves. So the search must
 * never return nothing — see `searchSegments`, which always affirms.
 */

export interface Segment {
  key: string;
  name: string;
  aliases: string[];
  group: 'trade' | 'food' | 'retail' | 'transport' | 'agri' | 'group' | 'org' | 'prof' | 'inst';
  papers: string[];
}

export const PAPER_LABELS: Record<string, string> = {
  P: 'Trading record',
  B: 'Business registration',
  C: 'KRA PIN and eTIMS',
  H: "Food handler's certificate",
  S: 'Group or sacco membership',
  G: 'Group registration',
  E: 'Sector licence or permit',
  I: 'Institution account',
};

export const SEGMENTS: Segment[] = [
  { key: "carpenters-and-joinery-workshops", name: "Carpenters and joinery workshops", aliases: ["carpenter", "carpentry", "joinery", "seremala", "fundi", "wa", "mbao", "furniture", "woodwork", "timber", "joint", "joints"], group: "trade", papers: ["P", "B", "C"] },
  { key: "masons-and-construction-fundis", name: "Masons and construction fundis", aliases: ["mason", "construction", "fundi", "ujenzi", "building", "bricklayer", "contractor", "jenga"], group: "trade", papers: ["P", "B", "C"] },
  { key: "welders-and-metal-fabricators", name: "Welders and metal fabricators", aliases: ["welder", "welding", "metal", "fabrication", "fundi", "chuma", "grills", "gates"], group: "trade", papers: ["P", "B", "C"] },
  { key: "motor-mechanics-and-garages", name: "Motor mechanics and garages", aliases: ["mechanic", "garage", "fundi", "gari", "motor", "vehicle", "repair", "panel", "beater"], group: "trade", papers: ["P", "B", "C"] },
  { key: "electricians", name: "Electricians", aliases: ["electrician", "wiring", "electrical", "fundi", "stima", "solar", "installer"], group: "trade", papers: ["P", "B", "C"] },
  { key: "plumbers", name: "Plumbers", aliases: ["plumber", "plumbing", "fundi", "mabomba", "water"], group: "trade", papers: ["P", "B", "C"] },
  { key: "tailors-and-dressmakers", name: "Tailors and dressmakers", aliases: ["tailor", "tailoring", "dressmaker", "mshonaji", "fundi", "nguo", "seamstress", "boutique"], group: "trade", papers: ["P", "B", "C"] },
  { key: "cobblers-and-shoe-repairers", name: "Cobblers and shoe repairers", aliases: ["cobbler", "shoe", "repair", "viatu", "mjengo", "leather"], group: "trade", papers: ["P", "B"] },
  { key: "painters-and-signwriters", name: "Painters and signwriters", aliases: ["painter", "painting", "signwriter", "branding"], group: "trade", papers: ["P", "B"] },
  { key: "jua-kali-artisans", name: "Jua kali artisans", aliases: ["jua", "kali", "artisan", "handcraft", "metalwork", "informal", "manufacturing"], group: "trade", papers: ["P", "B", "C"] },
  { key: "printers-and-graphic-shops", name: "Printers and graphic shops", aliases: ["printer", "printing", "graphics", "design", "cyber", "print"], group: "trade", papers: ["P", "B", "C"] },
  { key: "photographers-and-videographers", name: "Photographers and videographers", aliases: ["photographer", "photography", "video", "videographer", "studio"], group: "trade", papers: ["P", "B", "C"] },
  { key: "furniture-makers-and-upholsterers", name: "Furniture makers and upholsterers", aliases: ["furniture", "upholstery", "sofa", "bed", "mattress"], group: "trade", papers: ["P", "B", "C"] },
  { key: "mama-mboga-and-greengrocers", name: "Mama mboga and greengrocers", aliases: ["mama", "mboga", "vegetable", "greengrocer", "sukuma", "produce", "vendor", "soko"], group: "food", papers: ["P", "H", "B"] },
  { key: "butchers-and-meat-sellers", name: "Butchers and meat sellers", aliases: ["butcher", "butchery", "meat", "nyama", "bucha"], group: "food", papers: ["P", "H", "B", "C"] },
  { key: "food-vendors-and-mama-ntilie", name: "Food vendors and mama ntilie", aliases: ["food", "vendor", "mama", "ntilie", "kibanda", "street", "food", "chips", "smokie"], group: "food", papers: ["P", "H", "B"] },
  { key: "hotels-restaurants-and-eateries", name: "Hotels, restaurants and eateries", aliases: ["hotel", "restaurant", "eatery", "cafe", "kibanda", "catering", "chai"], group: "food", papers: ["P", "H", "B", "C"] },
  { key: "bakers-and-confectioners", name: "Bakers and confectioners", aliases: ["baker", "bakery", "bread", "cake", "mandazi", "confectioner"], group: "food", papers: ["P", "H", "B", "C"] },
  { key: "caterers-and-event-food", name: "Caterers and event food", aliases: ["caterer", "catering", "event", "food", "outside", "catering"], group: "food", papers: ["P", "H", "B"] },
  { key: "milk-and-dairy-vendors", name: "Milk and dairy vendors", aliases: ["milk", "maziwa", "dairy", "vendor", "atm", "milk", "bar"], group: "food", papers: ["P", "H", "B"] },
  { key: "fishmongers", name: "Fishmongers", aliases: ["fish", "fishmonger", "samaki", "omena"], group: "food", papers: ["P", "H", "B"] },
  { key: "cereal-and-grain-sellers", name: "Cereal and grain sellers", aliases: ["cereal", "grain", "maize", "beans", "rice", "unga", "posho", "mill"], group: "food", papers: ["P", "H", "B", "C"] },
  { key: "food-handlers", name: "Food handlers", aliases: ["food", "handling", "food", "handler", "hygiene", "certificate"], group: "food", papers: ["H", "P"] },
  { key: "shopkeepers-and-duka-owners", name: "Shopkeepers and duka owners", aliases: ["duka", "shop", "shopkeeper", "kiosk", "retail", "general", "shop"], group: "retail", papers: ["P", "B", "C"] },
  { key: "wholesalers-and-distributors", name: "Wholesalers and distributors", aliases: ["wholesaler", "wholesale", "distributor", "supplier", "stockist"], group: "retail", papers: ["P", "B", "C", "E"] },
  { key: "mitumba-and-clothes-traders", name: "Mitumba and clothes traders", aliases: ["mitumba", "secondhand", "clothes", "bale", "gikomba", "apparel"], group: "retail", papers: ["P", "B"] },
  { key: "hardware-and-building-supplies", name: "Hardware and building supplies", aliases: ["hardware", "building", "supplies", "cement", "paint", "tools"], group: "retail", papers: ["P", "B", "C", "E"] },
  { key: "agrovets-and-agro-dealers", name: "Agrovets and agro-dealers", aliases: ["agrovet", "agro", "dealer", "seeds", "fertiliser", "inputs", "veterinary"], group: "retail", papers: ["P", "B", "C", "E"] },
  { key: "chemists-and-pharmacies", name: "Chemists and pharmacies", aliases: ["chemist", "pharmacy", "drugs", "medicine", "dispensary"], group: "retail", papers: ["P", "B", "C", "E"] },
  { key: "m-pesa-and-mobile-money-agents", name: "M-Pesa and mobile money agents", aliases: ["mpesa", "m-pesa", "mobile", "money", "agent", "airtel", "float", "banking", "agent"], group: "retail", papers: ["P", "B", "C"] },
  { key: "cyber-cafes-and-digital-services", name: "Cyber cafes and digital services", aliases: ["cyber", "cafe", "internet", "computer", "bureau", "typing", "services"], group: "retail", papers: ["P", "B", "C"] },
  { key: "salons-barbers-and-kinyozi", name: "Salons, barbers and kinyozi", aliases: ["salon", "barber", "kinyozi", "hairdresser", "beauty", "spa", "nails"], group: "retail", papers: ["P", "H", "B"] },
  { key: "laundry-and-mama-fua-services", name: "Laundry and mama fua services", aliases: ["laundry", "mama", "fua", "dry", "cleaning", "washing"], group: "retail", papers: ["P", "B"] },
  { key: "stationery-and-bookshops", name: "Stationery and bookshops", aliases: ["stationery", "bookshop", "books", "school", "supplies"], group: "retail", papers: ["P", "B", "C"] },
  { key: "electronics-and-phone-shops", name: "Electronics and phone shops", aliases: ["electronics", "phone", "shop", "repair", "accessories", "tv"], group: "retail", papers: ["P", "B", "C"] },
  { key: "gas-and-fuel-retailers", name: "Gas and fuel retailers", aliases: ["gas", "cooking", "gas", "lpg", "fuel", "paraffin", "petrol"], group: "retail", papers: ["P", "B", "C", "E"] },
  { key: "water-vendors-and-suppliers", name: "Water vendors and suppliers", aliases: ["water", "vendor", "borehole", "tank", "supply"], group: "retail", papers: ["P", "B"] },
  { key: "boda-boda-riders-and-operators", name: "Boda boda riders and operators", aliases: ["boda", "boda", "rider", "motorbike", "motorcycle", "taxi", "pikipiki"], group: "transport", papers: ["P", "B", "S"] },
  { key: "matatu-owners-and-crew", name: "Matatu owners and crew", aliases: ["matatu", "psv", "conductor", "driver", "route", "sacco", "14", "seater"], group: "transport", papers: ["P", "B", "S", "C"] },
  { key: "tuk-tuk-operators", name: "Tuk tuk operators", aliases: ["tuktuk", "tuk", "tuk", "three", "wheeler"], group: "transport", papers: ["P", "B", "S"] },
  { key: "taxi-and-ride-hailing-drivers", name: "Taxi and ride-hailing drivers", aliases: ["taxi", "cab", "uber", "bolt", "little", "driver"], group: "transport", papers: ["P", "B", "S"] },
  { key: "truck-and-lorry-operators", name: "Truck and lorry operators", aliases: ["truck", "lorry", "haulage", "transporter", "cargo", "trailer"], group: "transport", papers: ["P", "B", "C", "E"] },
  { key: "mkokoteni-and-handcart-operators", name: "Mkokoteni and handcart operators", aliases: ["mkokoteni", "handcart", "cart", "pusher", "porter"], group: "transport", papers: ["P"] },
  { key: "courier-and-delivery-riders", name: "Courier and delivery riders", aliases: ["courier", "delivery", "dispatch", "parcel", "logistics"], group: "transport", papers: ["P", "B", "C"] },
  { key: "crop-farmers", name: "Crop farmers", aliases: ["farmer", "farming", "mkulima", "crop", "shamba", "maize", "beans", "potato"], group: "agri", papers: ["P", "B", "G", "E"] },
  { key: "horticulture-and-export-growers", name: "Horticulture and export growers", aliases: ["horticulture", "avocado", "french", "beans", "flowers", "export", "mango"], group: "agri", papers: ["P", "B", "C", "E", "G"] },
  { key: "dairy-farmers", name: "Dairy farmers", aliases: ["dairy", "cow", "milk", "zero", "grazing", "livestock"], group: "agri", papers: ["P", "B", "G", "E"] },
  { key: "poultry-keepers", name: "Poultry keepers", aliases: ["poultry", "chicken", "kuku", "eggs", "broiler", "layer"], group: "agri", papers: ["P", "B", "G", "E"] },
  { key: "pastoralists-and-livestock-keepers", name: "Pastoralists and livestock keepers", aliases: ["pastoralist", "livestock", "goat", "cattle", "camel", "mfugaji", "herder"], group: "agri", papers: ["P", "B", "G"] },
  { key: "fish-farmers-and-aquaculture", name: "Fish farmers and aquaculture", aliases: ["fish", "farming", "aquaculture", "pond", "tilapia"], group: "agri", papers: ["P", "B", "G", "E"] },
  { key: "beekeepers", name: "Beekeepers", aliases: ["beekeeper", "honey", "apiculture", "nyuki"], group: "agri", papers: ["P", "B", "G", "E"] },
  { key: "tea-and-coffee-growers", name: "Tea and coffee growers", aliases: ["tea", "coffee", "farmer", "factory", "cherry", "green", "leaf"], group: "agri", papers: ["P", "B", "G", "C"] },
  { key: "agro-processors-and-value-addition", name: "Agro-processors and value addition", aliases: ["processing", "value", "addition", "milling", "packaging", "agro", "processing"], group: "agri", papers: ["P", "B", "C", "E"] },
  { key: "chamas-and-investment-groups", name: "Chamas and investment groups", aliases: ["chama", "investment", "group", "merry", "go", "round", "table", "banking", "savings"], group: "group", papers: ["G", "P"] },
  { key: "self-help-groups", name: "Self-help groups", aliases: ["self", "help", "group", "shg", "community", "group", "registered", "group"], group: "group", papers: ["G", "P"] },
  { key: "women's-groups", name: "Women's groups", aliases: ["women", "group", "mama", "wanawake", "ladies", "group"], group: "group", papers: ["G", "P"] },
  { key: "youth-groups", name: "Youth groups", aliases: ["youth", "group", "vijana", "young", "people", "group"], group: "group", papers: ["G", "P"] },
  { key: "welfare-and-burial-societies", name: "Welfare and burial societies", aliases: ["welfare", "burial", "society", "benevolent", "fund", "harambee"], group: "group", papers: ["G", "P"] },
  { key: "community-based-organisations", name: "Community-based organisations", aliases: ["cbo", "community", "based", "organisation", "grassroots"], group: "group", papers: ["G", "P"] },
  { key: "faith-based-organisations", name: "Faith-based organisations", aliases: ["fbo", "faith", "based", "church", "mosque", "temple", "kanisa", "msikiti", "congregation", "religious"], group: "group", papers: ["G", "P"] },
  { key: "cooperatives", name: "Cooperatives", aliases: ["cooperative", "co-op", "ushirika", "farmers", "cooperative", "housing", "cooperative"], group: "group", papers: ["G", "B", "C"] },
  { key: "saccos", name: "SACCOs", aliases: ["sacco", "savings", "credit", "cooperative", "deposit", "taking"], group: "group", papers: ["G", "B", "C"] },
  { key: "farmer-and-producer-groups", name: "Farmer and producer groups", aliases: ["farmer", "group", "producer", "group", "cooperative", "society", "outgrower"], group: "group", papers: ["G", "P", "E"] },
  { key: "market-and-trader-associations", name: "Market and trader associations", aliases: ["market", "association", "traders", "union", "stall", "holders", "committee"], group: "group", papers: ["G", "P"] },
  { key: "ngos-and-non-profits", name: "NGOs and non-profits", aliases: ["ngo", "non", "profit", "charity", "foundation", "trust", "civil", "society"], group: "org", papers: ["G", "B", "C"] },
  { key: "schools-and-ecd-centres", name: "Schools and ECD centres", aliases: ["school", "ecd", "nursery", "kindergarten", "academy", "primary", "secondary"], group: "org", papers: ["G", "B", "C", "E"] },
  { key: "clinics-and-dispensaries", name: "Clinics and dispensaries", aliases: ["clinic", "dispensary", "health", "centre", "nursing", "home", "laboratory"], group: "org", papers: ["G", "B", "C", "E"] },
  { key: "children's-and-elderly-homes", name: "Children's and elderly homes", aliases: ["orphanage", "childrens", "home", "elderly", "rescue", "centre"], group: "org", papers: ["G", "B", "C"] },
  { key: "sports-clubs-and-teams", name: "Sports clubs and teams", aliases: ["sports", "club", "team", "football", "academy", "talent"], group: "org", papers: ["G", "P"] },
  { key: "cultural-and-arts-groups", name: "Cultural and arts groups", aliases: ["cultural", "group", "arts", "music", "dance", "drama", "theatre"], group: "org", papers: ["G", "P"] },
  { key: "community-libraries-and-resource-centres", name: "Community libraries and resource centres", aliases: ["library", "resource", "centre", "reading", "room"], group: "org", papers: ["G", "P"] },
  { key: "consultants-and-professional-services", name: "Consultants and professional services", aliases: ["consultant", "consultancy", "professional", "advisory", "accountant", "lawyer", "surveyor"], group: "prof", papers: ["P", "B", "C"] },
  { key: "building-contractors", name: "Building contractors", aliases: ["contractor", "construction", "company", "civil", "works", "ncal"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "security-firms-and-guards", name: "Security firms and guards", aliases: ["security", "guard", "watchman", "firm", "alarm"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "cleaning-and-fumigation-services", name: "Cleaning and fumigation services", aliases: ["cleaning", "fumigation", "pest", "control", "janitorial"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "landscaping-and-gardening", name: "Landscaping and gardening", aliases: ["landscaping", "gardening", "nursery", "seedlings", "lawn"], group: "prof", papers: ["P", "B"] },
  { key: "it-and-software-services", name: "IT and software services", aliases: ["it", "software", "developer", "tech", "computer", "services", "web"], group: "prof", papers: ["P", "B", "C"] },
  { key: "tuition-centres-and-trainers", name: "Tuition centres and trainers", aliases: ["tuition", "training", "centre", "coach", "tutor", "institute", "college"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "driving-schools", name: "Driving schools", aliases: ["driving", "school", "instructor", "licence"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "event-planners-and-djs", name: "Event planners and DJs", aliases: ["event", "planner", "dj", "tent", "chairs", "decor", "wedding", "pa", "system"], group: "prof", papers: ["P", "B"] },
  { key: "quarry-sand-and-ballast", name: "Quarry, sand and ballast", aliases: ["quarry", "sand", "ballast", "murram", "harvesting", "stone"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "charcoal-firewood-and-briquettes", name: "Charcoal, firewood and briquettes", aliases: ["charcoal", "firewood", "briquette", "makaa", "energy"], group: "prof", papers: ["P", "B", "E"] },
  { key: "real-estate-and-property-agents", name: "Real estate and property agents", aliases: ["real", "estate", "property", "agent", "rental", "caretaker", "landlord"], group: "prof", papers: ["P", "B", "C"] },
  { key: "waste-collection-and-recycling", name: "Waste collection and recycling", aliases: ["waste", "garbage", "collection", "recycling", "scrap", "plastic"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "tour-operators-and-guides", name: "Tour operators and guides", aliases: ["tour", "operator", "guide", "travel", "safari", "tourism"], group: "prof", papers: ["P", "B", "C", "E"] },
  { key: "banks-and-microfinance", name: "Banks and microfinance", aliases: ["bank", "microfinance", "mfi", "lender", "lending", "credit", "dcp"], group: "inst", papers: ["I"] },
  { key: "insurers-and-underwriters", name: "Insurers and underwriters", aliases: ["insurance", "insurer", "underwriter", "broker", "cover", "bima"], group: "inst", papers: ["I"] },
  { key: "buyers-offtakers-and-exporters", name: "Buyers, offtakers and exporters", aliases: ["buyer", "offtaker", "exporter", "procurement", "supermarket", "processor"], group: "inst", papers: ["I"] },
  { key: "county-governments", name: "County governments", aliases: ["county", "government", "devolved", "licensing", "revenue", "ward"], group: "inst", papers: ["I"] },
  { key: "ministries-and-agencies", name: "Ministries and agencies", aliases: ["ministry", "government", "agency", "state", "department", "authority"], group: "inst", papers: ["I"] },
  { key: "development-partners-and-programmes", name: "Development partners and programmes", aliases: ["donor", "development", "partner", "programme", "grant", "funder", "project"], group: "inst", papers: ["I"] },
  { key: "training-and-certification-bodies", name: "Training and certification bodies", aliases: ["training", "certification", "examining", "body", "accreditation", "tvet"], group: "inst", papers: ["I"] }
];

function score(s: Segment, t: string): number {
  const toks = [...s.aliases, ...s.name.toLowerCase().split(/[^a-z0-9]+/)].filter(Boolean);
  let best = 0;
  for (const k of toks) {
    if (k === t) best = Math.max(best, 100);
    else if (k.startsWith(t)) best = Math.max(best, 60);
    else if (t.length > 3 && k.includes(t)) best = Math.max(best, 25);
  }
  if (t.length > 3 && s.name.toLowerCase().includes(t)) best = Math.max(best, 40);

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const all = words.every((w) => toks.some((k) => k.startsWith(w)));
    best = all ? Math.max(best, 80) : 0;
  }
  return best;
}

export interface SegmentMatch {
  segment: Segment | null;
  /** Never false. Every kind of work is included — that is the point. */
  affirmed: true;
  freeText?: string;
}

/**
 * Always affirms. An unlisted trade returns `segment: null` with the raw
 * text preserved, and the caller shows "Esoko is for you too".
 */
export function searchSegments(query: string, limit = 4): Segment[] {
  const t = query.trim().toLowerCase();
  if (t.length < 2) return [];
  const min = t.length <= 3 ? 60 : 25;
  return SEGMENTS.map((s) => ({ s, v: score(s, t) }))
    .filter((o) => o.v >= min)
    .sort((a, b) => b.v - a.v)
    .slice(0, limit)
    .map((o) => o.s);
}

export function resolveSegment(query: string): SegmentMatch {
  const hits = searchSegments(query, 1);
  return hits.length
    ? { segment: hits[0], affirmed: true }
    : { segment: null, affirmed: true, freeText: query.trim() };
}

export function papersFor(query: string): string[] {
  const m = resolveSegment(query);
  const keys = m.segment?.papers ?? ['P', 'B', 'C'];
  return keys.map((k) => PAPER_LABELS[k]).filter(Boolean);
}
