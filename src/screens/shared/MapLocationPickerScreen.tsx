import { useMemo, useState } from "react";
import { CommonActions } from "@react-navigation/native";
import { View, Text, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Button, TextInput } from "react-native-paper";
import * as Location from "expo-location";
import OsmMapEmbed from "../../components/OsmMapEmbed";
import {
  ReverseGeocodedAddress,
  formatAddressLabel,
  getAddressLocalityLabel,
  mergeReverseGeocodedAddresses,
  normalizeNominatimAddress,
  normalizeExpoAddress,
} from "../../utils/locationAddress";

type SelectedLocation = {
  latitude: number;
  longitude: number;
};

type Region = {
  latitude: number;
  longitude: number;
};

const DEFAULT_REGION: Region = {
  latitude: 14.5995,
  longitude: 120.9842,
};

const toRegion = (location?: SelectedLocation | null): Region => ({
  latitude: location?.latitude ?? DEFAULT_REGION.latitude,
  longitude: location?.longitude ?? DEFAULT_REGION.longitude,
});

const reverseGeocodeWithNominatim = async (location: SelectedLocation): Promise<ReverseGeocodedAddress | null> => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.latitude}&lon=${location.longitude}&addressdetails=1`;
  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en",
      "User-Agent": "LifeCycle/1.0",
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const normalized = normalizeNominatimAddress(data?.address || {});
  return {
    ...normalized,
    formattedAddress: formatAddressLabel(normalized) || data?.display_name || "",
  };
};

const reverseGeocodeWithExpo = async (location: SelectedLocation): Promise<ReverseGeocodedAddress | null> => {
  const [rawAddress] = await Location.reverseGeocodeAsync(location);
  if (!rawAddress) return null;

  const normalized = normalizeExpoAddress(rawAddress);
  return {
    ...normalized,
    formattedAddress: formatAddressLabel(normalized),
  };
};

export default function MapLocationPickerScreen({ navigation, route }: any) {
  const returnScreen = route.params?.returnScreen;
  const returnRouteKey = route.params?.returnRouteKey;
  const initialLocation = route.params?.initialLocation as SelectedLocation | null | undefined;
  const draft = route.params?.draft || null;

  const [region, setRegion] = useState<Region>(toRegion(initialLocation));
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(initialLocation || null);
  const [manualLatitude, setManualLatitude] = useState((initialLocation?.latitude ?? DEFAULT_REGION.latitude).toString());
  const [manualLongitude, setManualLongitude] = useState((initialLocation?.longitude ?? DEFAULT_REGION.longitude).toString());
  const [loadingCurrentLocation, setLoadingCurrentLocation] = useState(false);
  const [saving, setSaving] = useState(false);

  const locationLabel = useMemo(() => {
    if (!selectedLocation) return "No pin selected yet.";
    return `Lat: ${selectedLocation.latitude.toFixed(6)} | Lng: ${selectedLocation.longitude.toFixed(6)}`;
  }, [selectedLocation]);

  const setMapLocation = (location: SelectedLocation) => {
    setSelectedLocation(location);
    setManualLatitude(location.latitude.toString());
    setManualLongitude(location.longitude.toString());
    setRegion({
      latitude: location.latitude,
      longitude: location.longitude,
    });
  };

  const useCurrentLocation = async () => {
    setLoadingCurrentLocation(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission required", "Location permission is needed to auto-detect your location.");
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setMapLocation({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      });
    } catch (error: any) {
      Alert.alert("Location Error", error?.message || "Unable to get your current location.");
    } finally {
      setLoadingCurrentLocation(false);
    }
  };

  const applyManualCoordinates = () => {
    const lat = Number(manualLatitude);
    const lng = Number(manualLongitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert("Invalid coordinates", "Please enter valid latitude and longitude values.");
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert("Out of range", "Latitude must be -90 to 90 and longitude must be -180 to 180.");
      return;
    }

    setMapLocation({ latitude: lat, longitude: lng });
  };

  const saveLocation = async () => {
    if (!selectedLocation) {
      Alert.alert("No location selected", "Tap the map, use current location, or apply coordinates first.");
      return;
    }
    if (!returnScreen) {
      Alert.alert("Navigation Error", "Cannot return location because return screen was not provided.");
      return;
    }

    setSaving(true);
    try {
      let selectedAddress: ReverseGeocodedAddress | null = null;
      try {
        const [expoAddress, nominatimAddress] = await Promise.all([
          reverseGeocodeWithExpo(selectedLocation).catch(() => null),
          reverseGeocodeWithNominatim(selectedLocation).catch(() => null),
        ]);
        selectedAddress = mergeReverseGeocodedAddresses(expoAddress, nominatimAddress);
      } catch {
        selectedAddress = null;
      }

      const autoLocality = getAddressLocalityLabel(selectedAddress);
      const nextParams = {
        selectedLocation,
        selectedCity: autoLocality || "",
        selectedLocationLabel:
          selectedAddress?.formattedAddress ||
          `Lat: ${selectedLocation.latitude.toFixed(6)} | Lng: ${selectedLocation.longitude.toFixed(6)}`,
        selectedAddress,
        draft: draft
          ? {
              ...draft,
              city: autoLocality || draft?.city || "",
            }
          : draft,
        fromMapPicker: Date.now(),
      };

      if (returnRouteKey) {
        navigation.dispatch({
          ...CommonActions.setParams(nextParams),
          source: returnRouteKey,
        });
        navigation.goBack();
        return;
      }

      navigation.navigate({
        name: returnScreen,
        params: nextParams,
        merge: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.caption}>Tap directly on the map to set your pin.</Text>
      <Text style={styles.coords}>{locationLabel}</Text>

      <View style={styles.controls}>
        <TextInput
          mode="outlined"
          label="Latitude"
          value={manualLatitude}
          onChangeText={setManualLatitude}
          keyboardType="decimal-pad"
          style={styles.coordInput}
        />
        <TextInput
          mode="outlined"
          label="Longitude"
          value={manualLongitude}
          onChangeText={setManualLongitude}
          keyboardType="decimal-pad"
          style={styles.coordInput}
        />
        <Button mode="outlined" onPress={applyManualCoordinates}>Apply Coordinates</Button>
      </View>

      <View style={styles.mapWrap}>
        <OsmMapEmbed
          latitude={region.latitude}
          longitude={region.longitude}
          height={320}
          zoom={13}
          selectedLocation={selectedLocation}
          enableLocationPick
          onLocationPick={setMapLocation}
        />
      </View>

      <View style={styles.actions}>
        {loadingCurrentLocation ? (
          <ActivityIndicator size="small" color="#d32f2f" />
        ) : (
          <Button mode="outlined" onPress={useCurrentLocation}>Use Current Location</Button>
        )}
        <Button mode="contained" onPress={saveLocation} loading={saving} disabled={saving}>
          {saving ? "Saving..." : "Save Location"}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
  },
  caption: {
    fontSize: 14,
    color: "#444",
    marginBottom: 6,
  },


  coords: {
    fontSize: 12,
    color: "#666",
    marginBottom: 10,
  },
  controls: {
    marginBottom: 10,
    gap: 8,
  },
  coordInput: {
    backgroundColor: "#fff",
  },
  mapWrap: {
    flex: 1,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#e8e8e8",
  },
  actions: {
    paddingTop: 12,
    paddingBottom: 6,
    gap: 10,
  },
});


