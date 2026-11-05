/**
 * SHARED GEO UTILITIES — Haversine, delivery fee, radius check.
 *
 * Usage:
 *   import { calculateDistance, getFeeFromSlabs, isWithinRadius } from '../shared/geo/geo.js';
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Haversine formula — distance in KM between two lat/lng points.
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
}

/**
 * Calculate delivery fee from distance slabs.
 * slabs: [{ km: number, fee: number }, ...]  (sorted ascending by km)
 */
export function getFeeFromSlabs(distance, slabs) {
    if (!slabs || slabs.length === 0) return 0;
    for (const slab of slabs) {
        if (distance <= slab.km) return slab.fee;
    }
    return slabs[slabs.length - 1].fee;
}

/**
 * Returns true if (lat1, lon1) is within `radiusKm` of (lat2, lon2).
 */
export function isWithinRadius(lat1, lon1, lat2, lon2, radiusKm = 0.5) {
    return calculateDistance(lat1, lon1, lat2, lon2) <= radiusKm;
}
