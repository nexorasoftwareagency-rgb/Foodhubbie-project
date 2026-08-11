// === src/components/active-trip/TripMap.tsx ===
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { useLocationContext } from "@/contexts/LocationContext";

const riderIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#E84908;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);" class="animate-pulse-dot"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function destinationIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:30px;height:38px;transform:translate(-50%,-100%);">
        <svg width="30" height="38" viewBox="0 0 30 38" fill="none">
          <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.7 23.3 0 15 0z" fill="${color}"/>
          <circle cx="15" cy="15" r="6" fill="#fff"/>
        </svg>
      </div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
    } else if (points.length === 1) {
      map.setView(points[0], 15);
    }
  }, [map, points]);
  return null;
}

type Stop = { lat: number; lng: number; label: string; color?: string };

export function TripMap({
  destination,
  destinationLabel,
  destinationColor = "#1E293B",
  secondaryStop,
}: {
  /** Omit to render "default mode" — just the rider's own live position. */
  destination?: { lat: number; lng: number };
  destinationLabel?: string;
  destinationColor?: string;
  /** An additional stop to render alongside the primary destination (e.g. outlet + customer together). */
  secondaryStop?: Stop;
}) {
  const { location } = useLocationContext();
  const riderPos = location ? ([location.lat, location.lng] as [number, number]) : null;
  const destPos: [number, number] | null = destination ? [destination.lat, destination.lng] : null;
  const secondaryPos: [number, number] | null = secondaryStop ? [secondaryStop.lat, secondaryStop.lng] : null;

  const destIcon = useMemo(() => destinationIcon(destinationColor), [destinationColor]);
  const secondaryIcon = useMemo(() => destinationIcon(secondaryStop?.color || "#3B82F6"), [secondaryStop?.color]);

  const points = useMemo(() => {
    const pts: [number, number][] = [];
    if (riderPos) pts.push(riderPos);
    if (destPos) pts.push(destPos);
    if (secondaryPos) pts.push(secondaryPos);
    return pts;
  }, [riderPos, destPos, secondaryPos]);

  const center = riderPos || destPos || [20.5937, 78.9629]; // fallback: center of India while GPS warms up

  return (
    <div className="h-[150px] rounded-[20px] overflow-hidden border border-border/70 mb-3.5 relative z-0">
      <MapContainer
        center={center as [number, number]}
        zoom={15}
        scrollWheelZoom={false}
        dragging={true}
        zoomControl={false}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
          subdomains={["a", "b", "c"]}
        />
        {riderPos && (
          <Marker position={riderPos} icon={riderIcon}>
            <Popup>You are here</Popup>
          </Marker>
        )}
        {destPos && destination && (
          <Marker position={destPos} icon={destIcon}>
            <Popup>{destinationLabel || "Destination"}</Popup>
          </Marker>
        )}
        {secondaryPos && secondaryStop && (
          <Marker position={secondaryPos} icon={secondaryIcon}>
            <Popup>{secondaryStop.label}</Popup>
          </Marker>
        )}
        {riderPos && destPos && (
          <Polyline
            positions={[riderPos, destPos]}
            pathOptions={{ color: "#E84908", weight: 3, dashArray: "6 8", opacity: 0.6 }}
          />
        )}
        {points.length > 0 && <FitBounds points={points} />}
      </MapContainer>
    </div>
  );
}
