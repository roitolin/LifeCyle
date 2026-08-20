import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  description?: string;
  color?: string;
};

type OsmMapEmbedProps = {
  latitude: number;
  longitude: number;
  height?: number;
  zoom?: number;
  markers?: MapMarker[];
  selectedLocation?: { latitude: number; longitude: number } | null;
  enableLocationPick?: boolean;
  onLocationPick?: (location: { latitude: number; longitude: number }) => void;
};

const buildMapHtml = ({
  latitude,
  longitude,
  zoom,
  markers,
  selectedLocation,
  enableLocationPick,
}: {
  latitude: number;
  longitude: number;
  zoom: number;
  markers: MapMarker[];
  selectedLocation: { latitude: number; longitude: number } | null;
  enableLocationPick: boolean;
}) => {
  const markersJson = JSON.stringify(markers);
  const selectedJson = JSON.stringify(selectedLocation);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
      .leaflet-container { font-family: Arial, sans-serif; }
      .picker-hint {
        position: absolute;
        z-index: 1000;
        top: 8px;
        left: 8px;
        background: rgba(255,255,255,0.95);
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 11px;
        color: #4b5563;
      }
    </style>
  </head>
  <body>
    ${enableLocationPick ? '<div class="picker-hint">Tap map to set location pin</div>' : ""}
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      (function () {
        var map = L.map('map', { zoomControl: true }).setView([${latitude}, ${longitude}], ${zoom});

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        var providerMarkers = ${markersJson};
        var selectedLocation = ${selectedJson};

        var bounds = [];

        providerMarkers.forEach(function (item) {
          if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') return;

          var marker = L.circleMarker([item.latitude, item.longitude], {
            radius: 7,
            color: item.color || '#dc2626',
            fillColor: item.color || '#dc2626',
            fillOpacity: 0.9,
            weight: 2,
          }).addTo(map);

          var popupParts = [];
          if (item.label) popupParts.push('<strong>' + item.label + '</strong>');
          if (item.description) popupParts.push('<div>' + item.description + '</div>');
          if (popupParts.length) marker.bindPopup(popupParts.join(''));

          bounds.push([item.latitude, item.longitude]);
        });

        var selectedMarker = null;
        function updateSelectedMarker(lat, lng) {
          if (!selectedMarker) {
            selectedMarker = L.circleMarker([lat, lng], {
              radius: 8,
              color: '#2563eb',
              fillColor: '#2563eb',
              fillOpacity: 0.9,
              weight: 2,
            }).addTo(map);
          } else {
            selectedMarker.setLatLng([lat, lng]);
          }
        }

        if (selectedLocation && typeof selectedLocation.latitude === 'number' && typeof selectedLocation.longitude === 'number') {
          updateSelectedMarker(selectedLocation.latitude, selectedLocation.longitude);
          bounds.push([selectedLocation.latitude, selectedLocation.longitude]);
        }

        if (bounds.length > 1) {
          map.fitBounds(bounds, { padding: [24, 24] });
        }

        if (${enableLocationPick ? "true" : "false"}) {
          map.on('click', function (event) {
            var lat = Number(event.latlng.lat.toFixed(6));
            var lng = Number(event.latlng.lng.toFixed(6));
            updateSelectedMarker(lat, lng);

            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'location-pick',
                latitude: lat,
                longitude: lng,
              }));
            }
          });
        }
      })();
    </script>
  </body>
</html>`;
};

export default function OsmMapEmbed({
  latitude,
  longitude,
  height = 220,
  zoom = 13,
  markers = [],
  selectedLocation = null,
  enableLocationPick = false,
  onLocationPick,
}: OsmMapEmbedProps) {
  const html = buildMapHtml({
    latitude,
    longitude,
    zoom,
    markers,
    selectedLocation,
    enableLocationPick,
  });

  const handleMessage = (event: any) => {
    if (!onLocationPick) return;

    try {
      const payload = JSON.parse(event.nativeEvent.data || "{}");
      if (payload?.type === "location-pick" && typeof payload.latitude === "number" && typeof payload.longitude === "number") {
        onLocationPick({ latitude: payload.latitude, longitude: payload.longitude });
      }
    } catch {
      // ignore malformed message payloads
    }
  };

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        source={{ html }}
        style={styles.frame}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        mixedContentMode="always"
        onMessage={handleMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: "#e8e8e8",
  },
  frame: {
    borderWidth: 0,
    width: "100%",
    height: "100%",
  },
});
