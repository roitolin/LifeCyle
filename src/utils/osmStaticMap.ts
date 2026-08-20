type StaticMapOptions = {
  zoom?: number;
  width?: number;
  height?: number;
};

export const buildOsmStaticMapUrl = (
  latitude: number,
  longitude: number,
  options: StaticMapOptions = {}
) => {
  const zoom = options.zoom ?? 15;
  const width = options.width ?? 900;
  const height = options.height ?? 420;

  return (
    "https://staticmap.openstreetmap.de/staticmap.php" +
    `?center=${latitude},${longitude}` +
    `&zoom=${zoom}` +
    `&size=${width}x${height}` +
    `&markers=${latitude},${longitude},red-pushpin`
  );
};
