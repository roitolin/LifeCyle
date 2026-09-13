import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

type BarDatum = {
  label: string;
  value: number;
  color?: string;
};

type SimpleBarChartProps = {
  data: BarDatum[];
  height?: number;
  formatValue?: (value: number) => string;
  showValues?: boolean;
  barColor?: string;
};

const VALUE_LABEL_SPACE = 18;
const X_LABEL_SPACE = 18;

export default function SimpleBarChart({
  data,
  height = 140,
  formatValue,
  showValues = false,
  barColor = "#d32f2f",
}: SimpleBarChartProps) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);
  const plotHeight = Math.max(20, height - (showValues ? VALUE_LABEL_SPACE : 0) - X_LABEL_SPACE);

  return (
    <View style={styles.wrap}>
      <View style={[styles.chartArea, { height }]}>
        {data.length === 0 ? (
          <Text style={styles.emptyText}>No data yet</Text>
        ) : (
          <>
            <View
              pointerEvents="none"
              style={[styles.grid, { top: showValues ? VALUE_LABEL_SPACE : 0, bottom: X_LABEL_SPACE }]}
            >
              {[0, 1, 2, 3].map((line) => <View key={line} style={styles.gridLine} />)}
            </View>
            {data.map((d, index) => {
              const ratio = d.value / max;
              const barHeight = Math.max(2, Math.round(plotHeight * ratio));

              return (
                <View
                  key={`${d.label}-${index}`}
                  accessible
                  accessibilityLabel={`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
                  style={styles.barColumn}
                >
                  {showValues ? (
                    <Text style={styles.valueLabel} numberOfLines={1}>
                      {formatValue ? formatValue(d.value) : String(d.value)}
                    </Text>
                  ) : null}
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barHeight,
                          backgroundColor: d.color || barColor,
                          opacity: index === data.length - 1 ? 1 : 0.78,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.xLabel, index === data.length - 1 ? styles.xLabelCurrent : null]} numberOfLines={1}>
                    {d.label}
                  </Text>
                </View>
              );
            })}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
  },
  chartArea: {
    position: "relative",
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-around",
    gap: 6,
  },
  grid: {
    position: "absolute",
    left: 0,
    right: 0,
    justifyContent: "space-between",
  },
  gridLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#dfe5e1",
  },
  barColumn: {
    flex: 1,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  barTrack: {
    width: "100%",
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  bar: {
    width: "65%",
    minWidth: 10,
    maxWidth: 40,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  valueLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#475569",
    marginBottom: 2,
    maxWidth: "100%",
  },
  xLabel: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 4,
    fontWeight: "600",
    maxWidth: "100%",
  },
  xLabelCurrent: {
    color: "#2f403a",
    fontWeight: "800",
  },
  emptyText: {
    textAlign: "center",
    color: "#94a3b8",
    width: "100%",
    paddingTop: 30,
  },
});
