import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

export type DonutDatum = {
  label: string;
  value: number;
  color: string;
};

type StatusDonutChartProps = {
  data: DonutDatum[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
};

export default function StatusDonutChart({
  data,
  size = 176,
  strokeWidth = 28,
  centerLabel = "Cases",
}: StatusDonutChartProps) {
  const segments = useMemo(() => data.filter((item) => item.value > 0), [data]);
  const total = useMemo(() => segments.reduce((sum, item) => sum + item.value, 0), [segments]);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const chartSegments = useMemo(
    () => segments.map((item, index) => {
      const precedingValue = segments
        .slice(0, index)
        .reduce((sum, precedingItem) => sum + precedingItem.value, 0);
      const length = total > 0 ? (item.value / total) * circumference : 0;
      const dashOffset = total > 0 ? -(precedingValue / total) * circumference : 0;
      return { ...item, length, dashOffset };
    }),
    [circumference, segments, total]
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        total > 0
          ? `${centerLabel}: ${total}. ${segments.map((item) => `${item.label} ${item.value}`).join(", ")}`
          : `No ${centerLabel.toLowerCase()} to chart`
      }
      style={[styles.wrap, { width: size, height: size }]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e8ece9"
            strokeWidth={strokeWidth}
          />
          {chartSegments.map((item) => (
            <Circle
              key={item.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${item.length} ${Math.max(0, circumference - item.length)}`}
              strokeDashoffset={item.dashOffset}
              strokeLinecap="butt"
            />
          ))}
        </G>
      </Svg>
      <View pointerEvents="none" style={styles.center}>
        <Text style={styles.total}>{total}</Text>
        <Text style={styles.label}>{centerLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  total: {
    color: "#22312d",
    fontSize: 28,
    fontWeight: "900",
  },
  label: {
    color: "#74807b",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
});
