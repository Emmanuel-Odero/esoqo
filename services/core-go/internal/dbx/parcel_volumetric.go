package dbx

import "math"

// Chargeable weight: the rule every carrier uses and Esoqo did not.
//
// A parcel occupies two scarce things — mass and space — and a vehicle
// runs out of one or the other, whichever comes first. Charging on mass
// alone means a van full of empty cartons earns almost nothing while
// being exactly as full as a van that earns well. The trade's answer,
// unchanged for decades, is to convert volume into a notional weight
// and charge whichever is greater.

// DefaultVolumetricDivisor is the IATA air convention: centimetres
// cubed, divided by 5000, gives kilogrammes.
//
// Road freight commonly uses 6000, which charges bulky goods less. The
// right number for a matatu-and-boda network is a commercial decision
// rather than an engineering one — it moves real prices for real
// customers — so it is configurable and this is only the default. See
// PARCEL_VOLUMETRIC_DIVISOR.
const DefaultVolumetricDivisor = 5000.0

// VolumetricKg converts a box's dimensions to the weight it will be
// charged as if that exceeds what it actually weighs.
//
// Returns 0 when any dimension is missing or non-positive, which means
// "we didn't measure" rather than "it has no volume" — and 0 loses to
// any real weight in ChargeableKg, so an unmeasured parcel is charged
// exactly as it was before. Partial measurements must never invent a
// price: a clerk who filled in two of three boxes has not told us the
// volume, and guessing the third would produce a number with a
// customer's money attached to it.
func VolumetricKg(lengthCm, widthCm, heightCm, divisor float64) float64 {
	if lengthCm <= 0 || widthCm <= 0 || heightCm <= 0 {
		return 0
	}
	if divisor <= 0 {
		divisor = DefaultVolumetricDivisor
	}
	kg := (lengthCm * widthCm * heightCm) / divisor
	// Two decimal places, rounded half-up. Carriers round volumetric
	// weight rather than carrying float noise into a price, and a
	// customer re-measuring their own box at home should be able to
	// reproduce our number exactly.
	return math.Round(kg*100) / 100
}

// ChargeableKg is the greater of what a parcel weighs and what its
// bulk is worth. Either may be 0 (unweighed, unmeasured); if both are,
// the result is 0 and pricing falls back to whatever bracket the
// sender chose, exactly as before.
func ChargeableKg(actualKg, volumetricKg float64) float64 {
	return math.Max(actualKg, volumetricKg)
}

// VolumetricApplies reports whether bulk — not mass — is what this
// parcel will be charged on.
//
// Exists so the counter can *say so* rather than silently quoting a
// higher number. A clerk who can see "this is being charged as 14.4kg
// because it's bulky, not because it's heavy" can explain the price to
// the person holding the box; one who only sees the total cannot, and
// will assume the system is wrong. A price rise nobody can explain is
// a price rise that gets argued with at the counter.
func VolumetricApplies(actualKg, volumetricKg float64) bool {
	return volumetricKg > 0 && volumetricKg > actualKg
}
